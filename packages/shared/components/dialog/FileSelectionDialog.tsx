import React, { useEffect, useState, useCallback } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";

interface Segment {
	start: TimeParts;
	end: TimeParts;
}

interface FileSelectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	filePath: string;
	onConfirm?: (filePath: string, selectedChannels: string[], metadata: EdfMetadata | null, segment: Segment) => void;
}

export interface EdfMetadata {
	channels: string[];
	total_duration: number;
	[key: string]: any;
}

interface TimeParts {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

function timePartsToSeconds(tp: TimeParts): number {
	return tp.days * 86400 + tp.hours * 3600 + tp.minutes * 60 + tp.seconds;
}

function secondsToTimeParts(totalSeconds: number): TimeParts {
	const days = Math.floor(totalSeconds / 86400);
	totalSeconds %= 86400;
	const hours = Math.floor(totalSeconds / 3600);
	totalSeconds %= 3600;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return { days, hours, minutes, seconds };
}

export function FileSelectionDialog({ open, onOpenChange, filePath, onConfirm }: FileSelectionDialogProps) {
	const [metadata, setMetadata] = useState<EdfMetadata | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [validationError, setValidationError] = useState<string | null>(null);
	const [startTime, setStartTime] = useState<TimeParts>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
	const [endTime, setEndTime] = useState<TimeParts>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

	// Fetch metadata when dialog opens
	useEffect(() => {
		if (open && filePath) {
			setLoading(true);
			setError(null);
			fetch(`/api/edf/info?file_path=${encodeURIComponent(filePath)}`)
				.then(res => res.json())
				.then(data => {
					setMetadata(data);
					setSelectedChannels([]);
				})
				.catch(err => setError(err.message || "Failed to fetch metadata"))
				.finally(() => setLoading(false));
		}
	}, [open, filePath]);

	// Set end time to file duration if available
	useEffect(() => {
		if (metadata && metadata.total_duration && endTime.days === 0 && endTime.hours === 0 && endTime.minutes === 0 && endTime.seconds === 0) {
			const timeParts = secondsToTimeParts(Number(metadata.total_duration));
			setEndTime(timeParts);
		}
	}, [metadata]);

	// Handle channel toggle
	const toggleChannel = useCallback((channel: string) => {
		setSelectedChannels(prev =>
			prev.includes(channel)
				? prev.filter(c => c !== channel)
				: [...prev, channel]
		);
	}, []);

	// Handle select all/none
	const selectAll = useCallback(() => {
		if (metadata?.channels) setSelectedChannels(metadata.channels);
	}, [metadata]);
	const deselectAll = useCallback(() => setSelectedChannels([]), []);

	// Validation function for selected channels and segment
	const validateSelection = useCallback((channels: string[], start: TimeParts, end: TimeParts, duration?: number): string | null => {
		if (channels.length === 0) return "Please select at least one channel.";
		const startSec = timePartsToSeconds(start);
		const endSec = timePartsToSeconds(end);
		if (startSec < 0 || endSec < 0) return "Start and end time must be non-negative.";
		if (endSec <= startSec) return "End time must be after start time.";
		if (duration !== undefined) {
			if (startSec > duration) return "Start time exceeds file duration.";
			if (endSec > duration) return "End time exceeds file duration.";
		}
		return null;
	}, []);

	// Confirm selection
	const handleConfirm = () => {
		const duration = metadata && metadata.total_duration ? Number(metadata.total_duration) : undefined;
		const error = validateSelection(selectedChannels, startTime, endTime, duration);

		if (error) {
			setValidationError(error);
			return;
		}

		setValidationError(null);
		if (onConfirm) onConfirm(filePath, selectedChannels, metadata, { start: startTime, end: endTime } as Segment);
		onOpenChange(false);
	};

	// Filtered channels
	const filteredChannels = metadata?.channels?.filter(c =>
		c.toLowerCase().includes(search.toLowerCase())
	) || [];

	// Show all metadata except channels
	const metaEntries = metadata ? Object.entries(metadata).filter(([k]) => k !== "channels") : [];

	// Calculate last timestep as max values for segment fields
	const lastTimestep: TimeParts | null = metadata && metadata.total_duration
		? secondsToTimeParts(Number(metadata.total_duration))
		: null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Select File</DialogTitle>
				</DialogHeader>
				{loading ? (
					<div className="p-4 text-center">Loading metadata...</div>
				) : error ? (
					<div className="p-4 text-red-500">{error}</div>
				) : metadata ? (
					<>
						<div className="mb-4">
							<div className="font-semibold mb-2">File Metadata</div>
							<div className="grid grid-cols-2 gap-2 text-xs">
								{metaEntries.map(([k, v]) => (
									<React.Fragment key={k}>
										<div className="font-medium text-muted-foreground">{k}</div>
										<div className="break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
									</React.Fragment>
								))}
							</div>
						</div>
						<div className="mb-2 flex items-center gap-2">
							<Input
								placeholder="Search channels..."
								value={search}
								onChange={e => setSearch(e.target.value)}
								className="w-48"
							/>
							<Button size="sm" variant="outline" onClick={selectAll}>Select All</Button>
							<Button size="sm" variant="outline" onClick={deselectAll}>Deselect All</Button>
						</div>
						{validationError && (
							<div className="mb-2 text-red-500 text-sm">{validationError}</div>
						)}
						<ScrollArea className="h-64 border rounded-md">
							<div className="p-2 space-y-1">
								{filteredChannels.length === 0 ? (
									<div className="text-muted-foreground text-center">No channels found</div>
								) : filteredChannels.map(channel => (
									<div key={channel} className="flex items-center gap-2 p-1 hover:bg-muted/30 rounded">
										<Checkbox
											id={`channel-${channel}`}
											checked={selectedChannels.includes(channel)}
											onCheckedChange={() => toggleChannel(channel)}
										/>
										<Label htmlFor={`channel-${channel}`}>{channel}</Label>
									</div>
								))}
							</div>
						</ScrollArea>
						<div className="mt-4">
							<div className="font-semibold mb-2">Select Segment</div>
							<div className="flex flex-col md:flex-row flex-wrap gap-4 w-full">
								<div>
									<div className="text-xs font-medium mb-1">Start Time</div>
									<div className="flex gap-1 items-center">
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.days : undefined} value={startTime.days} onChange={e => setStartTime(s => ({ ...s, days: Number(e.target.value) }))} className="w-20" placeholder="Days" />
										<span>d</span>
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.hours : 23} value={startTime.hours} onChange={e => setStartTime(s => ({ ...s, hours: Number(e.target.value) }))} className="w-16" placeholder="Hrs" />
										<span>h</span>
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.minutes : 59} value={startTime.minutes} onChange={e => setStartTime(s => ({ ...s, minutes: Number(e.target.value) }))} className="w-16" placeholder="Min" />
										<span>m</span>
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.seconds : 59} value={startTime.seconds} onChange={e => setStartTime(s => ({ ...s, seconds: Number(e.target.value) }))} className="w-16" placeholder="Sec" />
										<span>s</span>
									</div>
								</div>
								<div>
									<div className="text-xs font-medium mb-1">End Time</div>
									<div className="flex gap-1 items-center">
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.days : undefined} value={endTime.days} onChange={e => setEndTime(s => ({ ...s, days: Number(e.target.value) }))} className="w-20" placeholder="Days" />
										<span>d</span>
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.hours : 23} value={endTime.hours} onChange={e => setEndTime(s => ({ ...s, hours: Number(e.target.value) }))} className="w-16" placeholder="Hrs" />
										<span>h</span>
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.minutes : 59} value={endTime.minutes} onChange={e => setEndTime(s => ({ ...s, minutes: Number(e.target.value) }))} className="w-16" placeholder="Min" />
										<span>m</span>
										<Input type="number" min={0} max={lastTimestep ? lastTimestep.seconds : 59} value={endTime.seconds} onChange={e => setEndTime(s => ({ ...s, seconds: Number(e.target.value) }))} className="w-16" placeholder="Sec" />
										<span>s</span>
									</div>
								</div>
							</div>
						</div>
						<DialogFooter className="mt-4">
							<Button onClick={() => onOpenChange(false)}>Cancel</Button>
							<Button onClick={handleConfirm} disabled={selectedChannels.length === 0}>OK</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
