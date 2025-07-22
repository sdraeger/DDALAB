from typing import List

import numpy as np
from loguru import logger


class ChannelSelector:
    def __init__(self, metadata_provider, chunk_reader):
        self.metadata_provider = metadata_provider
        self.chunk_reader = chunk_reader

    def get_intelligent_default_channels(
        self,
        file_path: str,
        max_channels: int = 5,
        chunk_start: int = 10000,
        test_chunk_size: int = 1000,
    ) -> List[str]:
        try:
            metadata = self.metadata_provider.get_file_metadata(file_path)
            if metadata is None:
                logger.error(
                    f"No metadata found for file {file_path}. Returning empty channel list."
                )
                return []
            all_channels = metadata.get("signal_labels", [])
            if not all_channels:
                return []
            logger.info(f"EDF file has {len(all_channels)} total channels")
            event_patterns = [
                "event",
                "annotation",
                "trigger",
                "marker",
                "status",
                "evt",
            ]
            non_eeg_patterns = [
                "ecg",
                "ekg",
                "emg",
                "eog",
                "pulse",
                "sat",
                "o2",
                "spo2",
                "resp",
                "hr",
                "temp",
            ]
            eeg_candidates = []
            filtered_out = []
            for channel in all_channels:
                channel_lower = channel.lower()
                is_event_channel = any(
                    pattern in channel_lower for pattern in event_patterns
                )
                is_non_eeg = any(
                    pattern in channel_lower for pattern in non_eeg_patterns
                )
                if not is_event_channel and not is_non_eeg:
                    eeg_candidates.append(channel)
                else:
                    filtered_out.append(channel)
            logger.info(
                f"Filtered out {len(filtered_out)} non-EEG channels: {filtered_out[:10]}..."
            )
            logger.info(f"EEG candidates: {len(eeg_candidates)} channels")
            try:
                from pyedflib import EdfReader

                with EdfReader(file_path) as reader:
                    problem_channels = []
                    good_channels = []
                    for i, channel_name in enumerate(all_channels):
                        if channel_name in eeg_candidates:
                            try:
                                phys_min = reader.getPhysicalMinimum(i)
                                phys_max = reader.getPhysicalMaximum(i)
                                if (
                                    phys_min > phys_max
                                    or abs(phys_min) > 10000
                                    or abs(phys_max) > 10000
                                ):
                                    problem_channels.append(channel_name)
                                else:
                                    good_channels.append(channel_name)
                            except Exception as e:
                                logger.warning(
                                    f"Could not validate channel {channel_name}: {e}"
                                )
                                problem_channels.append(channel_name)
                    logger.info(
                        f"Channels with problematic ranges: {len(problem_channels)}"
                    )
                    logger.info(f"Channels with good ranges: {len(good_channels)}")
                    if good_channels:
                        eeg_candidates = good_channels
                        logger.info(
                            f"Using {len(good_channels)} channels with valid physical ranges"
                        )
                    else:
                        max_channels = min(max_channels, 3)
                        logger.warning(
                            f"All channels have problematic ranges, limiting to {max_channels} channels"
                        )
            except Exception as validation_error:
                logger.warning(
                    f"Could not perform detailed channel validation: {validation_error}"
                )
            if len(eeg_candidates) >= max_channels:
                selected = eeg_candidates[:max_channels]
                logger.info(
                    f"Selected {len(selected)} EEG channels by name filtering: {selected}"
                )
                return selected
            logger.info("Testing signal variance for better channel selection...")
            try:
                edf_file, _ = self.chunk_reader.read_chunk_optimized(
                    file_path, chunk_start=chunk_start, chunk_size=test_chunk_size
                )
                channel_variances = []
                for i, signal in enumerate(edf_file.signals):
                    if i < len(all_channels):
                        try:
                            if signal.data is not None and len(signal.data) > 0:
                                data = np.array(signal.data)
                                clean_data = data[np.isfinite(data)]
                                if len(clean_data) > 0:
                                    variance = np.var(clean_data)
                                    if 0.001 < variance < 1e6:
                                        channel_variances.append(
                                            (all_channels[i], variance)
                                        )
                        except Exception as var_error:
                            logger.debug(
                                f"Error calculating variance for channel {all_channels[i]}: {var_error}"
                            )
                if channel_variances:
                    channel_variances.sort(key=lambda x: x[1], reverse=True)
                    selected_channels = [
                        channel for channel, _ in channel_variances[:max_channels]
                    ]
                    logger.info(
                        f"Selected {len(selected_channels)} channels with highest variance: {selected_channels}"
                    )
                    return selected_channels
                else:
                    logger.warning("No channels found with valid variance data")
            except Exception as variance_error:
                logger.warning(
                    f"Variance analysis failed: {variance_error}, using name-based selection"
                )
            if eeg_candidates:
                selected = eeg_candidates[:max_channels]
                logger.info(f"Fallback: using top EEG candidates: {selected}")
                return selected
            if len(all_channels) > 1:
                selected = all_channels[1 : max_channels + 1]
                logger.info(f"Last resort: using channels 1-{max_channels}: {selected}")
                return selected
            selected = all_channels[:max_channels]
            logger.info(
                f"Very last resort: using first {max_channels} channels: {selected}"
            )
            return selected
        except Exception as e:
            logger.error(f"Failed to get intelligent default channels: {e}")
            try:
                metadata = self.metadata_provider.get_file_metadata(file_path)
                all_channels = metadata.get("signal_labels", [])
                if len(all_channels) > 1:
                    return all_channels[1 : max_channels + 1]
                return all_channels[:max_channels]
            except Exception as fallback_error:
                logger.error(
                    f"Failed fallback to get intelligent default channels: {fallback_error}"
                )
                return []
