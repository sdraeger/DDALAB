// EDF (European Data Format) file reader/writer implementation
// Specification: https://www.edfplus.info/specs/edf.html

use rayon::prelude::*;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct EDFHeader {
    pub version: String,              // 8 bytes: version of this data format (0)
    pub patient_id: String,           // 80 bytes: local patient identification
    pub recording_id: String,         // 80 bytes: local recording identification
    pub start_date: String,           // 8 bytes: startdate of recording (dd.mm.yy)
    pub start_time: String,           // 8 bytes: starttime of recording (hh.mm.ss)
    pub header_bytes: usize,          // 8 bytes: number of bytes in header record
    pub reserved: String,             // 44 bytes: reserved
    pub num_data_records: i64,        // 8 bytes: number of data records (-1 if unknown)
    pub duration_of_data_record: f64, // 8 bytes: duration of a data record, in seconds
    pub num_signals: usize,           // 4 bytes: number of signals (channels)
}

#[derive(Debug, Clone)]
pub struct EDFSignalHeader {
    pub label: String,                 // 16 bytes: label (e.g. EEG Fpz-Cz)
    pub transducer_type: String,       // 80 bytes: transducer type (e.g. AgAgCl electrode)
    pub physical_dimension: String,    // 8 bytes: physical dimension (e.g. uV)
    pub physical_minimum: f64,         // 8 bytes: physical minimum
    pub physical_maximum: f64,         // 8 bytes: physical maximum
    pub digital_minimum: i64,          // 8 bytes: digital minimum
    pub digital_maximum: i64,          // 8 bytes: digital maximum
    pub prefiltering: String,          // 80 bytes: prefiltering
    pub num_samples_per_record: usize, // 8 bytes: number of samples in each data record
    pub reserved: String,              // 32 bytes: reserved
}

impl EDFSignalHeader {
    pub fn sample_frequency(&self, record_duration: f64) -> f64 {
        self.num_samples_per_record as f64 / record_duration
    }

    pub fn gain(&self) -> f64 {
        (self.physical_maximum - self.physical_minimum)
            / (self.digital_maximum - self.digital_minimum) as f64
    }

    pub fn offset(&self) -> f64 {
        self.physical_maximum - self.gain() * self.digital_maximum as f64
    }
}

pub struct EDFReader {
    file: BufReader<File>,
    pub header: EDFHeader,
    pub signal_headers: Vec<EDFSignalHeader>,
    data_start_offset: u64,
}

impl EDFReader {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
        let mut file = BufReader::new(file);

        // Read main header (256 bytes)
        let header = Self::read_header(&mut file)?;

        // Read signal headers
        let signal_headers = Self::read_signal_headers(&mut file, header.num_signals)?;

        let data_start_offset = header.header_bytes as u64;

        Ok(Self {
            file,
            header,
            signal_headers,
            data_start_offset,
        })
    }

    fn read_fixed_string<R: Read>(reader: &mut R, size: usize) -> Result<String, String> {
        let mut buffer = vec![0u8; size];
        reader
            .read_exact(&mut buffer)
            .map_err(|e| format!("Failed to read string: {}", e))?;
        Ok(String::from_utf8_lossy(&buffer).trim().to_string())
    }

    fn read_header<R: Read>(reader: &mut R) -> Result<EDFHeader, String> {
        let version = Self::read_fixed_string(reader, 8)?;
        let patient_id = Self::read_fixed_string(reader, 80)?;
        let recording_id = Self::read_fixed_string(reader, 80)?;
        let start_date = Self::read_fixed_string(reader, 8)?;
        let start_time = Self::read_fixed_string(reader, 8)?;

        let header_bytes_str = Self::read_fixed_string(reader, 8)?;
        let header_bytes = header_bytes_str
            .trim()
            .parse::<usize>()
            .map_err(|e| format!("Invalid header bytes '{}': {}", header_bytes_str, e))?;

        let reserved = Self::read_fixed_string(reader, 44)?;

        let num_data_records_str = Self::read_fixed_string(reader, 8)?;
        let num_data_records = num_data_records_str.trim().parse::<i64>().map_err(|e| {
            format!(
                "Invalid number of data records '{}': {}",
                num_data_records_str, e
            )
        })?;

        let duration_str = Self::read_fixed_string(reader, 8)?;
        let duration_of_data_record = duration_str
            .trim()
            .parse::<f64>()
            .map_err(|e| format!("Invalid duration '{}': {}", duration_str, e))?;

        let num_signals_str = Self::read_fixed_string(reader, 4)?;
        let num_signals = num_signals_str
            .trim()
            .parse::<usize>()
            .map_err(|e| format!("Invalid number of signals '{}': {}", num_signals_str, e))?;

        log::debug!(
            "EDF header parsed: num_data_records={}, duration_of_data_record={}, num_signals={}",
            num_data_records,
            duration_of_data_record,
            num_signals
        );

        Ok(EDFHeader {
            version,
            patient_id,
            recording_id,
            start_date,
            start_time,
            header_bytes,
            reserved,
            num_data_records,
            duration_of_data_record,
            num_signals,
        })
    }

    fn read_signal_headers<R: Read>(
        reader: &mut R,
        num_signals: usize,
    ) -> Result<Vec<EDFSignalHeader>, String> {
        let mut labels = Vec::new();
        let mut transducer_types = Vec::new();
        let mut physical_dimensions = Vec::new();
        let mut physical_minimums = Vec::new();
        let mut physical_maximums = Vec::new();
        let mut digital_minimums = Vec::new();
        let mut digital_maximums = Vec::new();
        let mut prefilterings = Vec::new();
        let mut num_samples_per_records = Vec::new();
        let mut reserveds = Vec::new();

        // Read each field for all signals
        for _ in 0..num_signals {
            labels.push(Self::read_fixed_string(reader, 16)?);
        }
        for _ in 0..num_signals {
            transducer_types.push(Self::read_fixed_string(reader, 80)?);
        }
        for _ in 0..num_signals {
            physical_dimensions.push(Self::read_fixed_string(reader, 8)?);
        }
        for _ in 0..num_signals {
            let s = Self::read_fixed_string(reader, 8)?;
            physical_minimums.push(
                s.trim()
                    .parse::<f64>()
                    .map_err(|e| format!("Invalid physical minimum '{}': {}", s, e))?,
            );
        }
        for _ in 0..num_signals {
            let s = Self::read_fixed_string(reader, 8)?;
            physical_maximums.push(
                s.trim()
                    .parse::<f64>()
                    .map_err(|e| format!("Invalid physical maximum '{}': {}", s, e))?,
            );
        }
        for _ in 0..num_signals {
            let s = Self::read_fixed_string(reader, 8)?;
            digital_minimums.push(
                s.trim()
                    .parse::<i64>()
                    .map_err(|e| format!("Invalid digital minimum '{}': {}", s, e))?,
            );
        }
        for _ in 0..num_signals {
            let s = Self::read_fixed_string(reader, 8)?;
            digital_maximums.push(
                s.trim()
                    .parse::<i64>()
                    .map_err(|e| format!("Invalid digital maximum '{}': {}", s, e))?,
            );
        }
        for _ in 0..num_signals {
            prefilterings.push(Self::read_fixed_string(reader, 80)?);
        }
        for _ in 0..num_signals {
            let s = Self::read_fixed_string(reader, 8)?;
            num_samples_per_records.push(
                s.trim()
                    .parse::<usize>()
                    .map_err(|e| format!("Invalid number of samples '{}': {}", s, e))?,
            );
        }
        for _ in 0..num_signals {
            reserveds.push(Self::read_fixed_string(reader, 32)?);
        }

        let mut signal_headers = Vec::new();
        for i in 0..num_signals {
            signal_headers.push(EDFSignalHeader {
                label: labels[i].clone(),
                transducer_type: transducer_types[i].clone(),
                physical_dimension: physical_dimensions[i].clone(),
                physical_minimum: physical_minimums[i],
                physical_maximum: physical_maximums[i],
                digital_minimum: digital_minimums[i],
                digital_maximum: digital_maximums[i],
                prefiltering: prefilterings[i].clone(),
                num_samples_per_record: num_samples_per_records[i],
                reserved: reserveds[i].clone(),
            });
        }

        Ok(signal_headers)
    }

    pub fn read_record(&mut self, record_index: usize) -> Result<Vec<Vec<i16>>, String> {
        if record_index >= self.header.num_data_records as usize {
            return Err(format!(
                "Record index {} out of bounds (max {})",
                record_index,
                self.header.num_data_records - 1
            ));
        }

        // Calculate record size in bytes (each sample is 2 bytes / 16 bits)
        let record_size: usize = self
            .signal_headers
            .iter()
            .map(|sh| sh.num_samples_per_record * 2)
            .sum();

        // Seek to the record
        let record_offset = self.data_start_offset + (record_index * record_size) as u64;
        self.file
            .seek(SeekFrom::Start(record_offset))
            .map_err(|e| format!("Failed to seek to record: {}", e))?;

        // Read all signals for this record
        let mut signals = Vec::new();
        for signal_header in &self.signal_headers {
            let mut samples = Vec::new();
            for _ in 0..signal_header.num_samples_per_record {
                let mut buf = [0u8; 2];
                self.file
                    .read_exact(&mut buf)
                    .map_err(|e| format!("Failed to read sample: {}", e))?;
                let sample = i16::from_le_bytes(buf);
                samples.push(sample);
            }
            signals.push(samples);
        }

        Ok(signals)
    }

    pub fn read_physical_record(&mut self, record_index: usize) -> Result<Vec<Vec<f64>>, String> {
        let digital_record = self.read_record(record_index)?;

        // Parallel conversion of digital to physical values across all channels
        let physical_record: Vec<Vec<f64>> = digital_record
            .par_iter()
            .enumerate()
            .map(|(signal_idx, digital_samples)| {
                let signal_header = &self.signal_headers[signal_idx];
                let gain = signal_header.gain();
                let offset = signal_header.offset();

                digital_samples
                    .iter()
                    .map(|&digital| gain * digital as f64 + offset)
                    .collect()
            })
            .collect();

        Ok(physical_record)
    }

    pub fn read_signal_window(
        &mut self,
        signal_index: usize,
        start_time_sec: f64,
        duration_sec: f64,
    ) -> Result<Vec<f64>, String> {
        if signal_index >= self.signal_headers.len() {
            return Err(format!("Signal index {} out of bounds", signal_index));
        }

        let signal_header = &self.signal_headers[signal_index];
        let record_duration = self.header.duration_of_data_record;

        // Calculate which records we need
        let start_record = (start_time_sec / record_duration).floor() as usize;
        let end_record = ((start_time_sec + duration_sec) / record_duration).ceil() as usize;
        let end_record = end_record.min(self.header.num_data_records as usize);

        // Calculate sample offsets within records
        let samples_per_record = signal_header.num_samples_per_record;
        let sample_rate = signal_header.sample_frequency(record_duration);
        let start_sample_in_first_record =
            ((start_time_sec % record_duration) * sample_rate) as usize;
        let total_samples_needed = (duration_sec * sample_rate).ceil() as usize;

        let mut result = Vec::new();
        let gain = signal_header.gain();
        let offset = signal_header.offset();

        for record_idx in start_record..end_record {
            let record = self.read_record(record_idx)?;
            let signal_samples = &record[signal_index];

            let start_idx = if record_idx == start_record {
                start_sample_in_first_record
            } else {
                0
            };

            let end_idx = samples_per_record.min(start_idx + (total_samples_needed - result.len()));

            for &digital in &signal_samples[start_idx..end_idx] {
                result.push(gain * digital as f64 + offset);
            }

            if result.len() >= total_samples_needed {
                break;
            }
        }

        Ok(result)
    }

    pub fn total_duration(&self) -> f64 {
        self.header.num_data_records as f64 * self.header.duration_of_data_record
    }
}

pub struct EDFWriter {
    file: File,
    header: EDFHeader,
    signal_headers: Vec<EDFSignalHeader>,
}

impl EDFWriter {
    pub fn new<P: AsRef<Path>>(
        path: P,
        patient_id: String,
        recording_id: String,
        start_date: String,
        start_time: String,
        signal_headers: Vec<EDFSignalHeader>,
    ) -> Result<Self, String> {
        let num_signals = signal_headers.len();
        let header_bytes = 256 + num_signals * 256;

        let header = EDFHeader {
            version: "0".to_string(),
            patient_id,
            recording_id,
            start_date,
            start_time,
            header_bytes,
            reserved: "".to_string(),
            num_data_records: -1,         // Will be updated when finalized
            duration_of_data_record: 1.0, // Default 1 second
            num_signals,
        };

        let file = File::create(path).map_err(|e| format!("Failed to create file: {}", e))?;

        let mut writer = Self {
            file,
            header,
            signal_headers,
        };

        writer.write_header()?;
        Ok(writer)
    }

    fn write_fixed_string(&mut self, s: &str, size: usize) -> Result<(), String> {
        let mut buffer = vec![b' '; size];
        let bytes = s.as_bytes();
        let copy_len = bytes.len().min(size);
        buffer[..copy_len].copy_from_slice(&bytes[..copy_len]);
        self.file
            .write_all(&buffer)
            .map_err(|e| format!("Failed to write string: {}", e))
    }

    fn write_header(&mut self) -> Result<(), String> {
        // Write main header (256 bytes) - clone strings to avoid borrow issues
        let version = self.header.version.clone();
        let patient_id = self.header.patient_id.clone();
        let recording_id = self.header.recording_id.clone();
        let start_date = self.header.start_date.clone();
        let start_time = self.header.start_time.clone();
        let header_bytes = self.header.header_bytes.to_string();
        let reserved = self.header.reserved.clone();
        let num_data_records = self.header.num_data_records.to_string();
        let duration_of_data_record = format!("{}", self.header.duration_of_data_record);
        let num_signals = self.header.num_signals.to_string();

        self.write_fixed_string(&version, 8)?;
        self.write_fixed_string(&patient_id, 80)?;
        self.write_fixed_string(&recording_id, 80)?;
        self.write_fixed_string(&start_date, 8)?;
        self.write_fixed_string(&start_time, 8)?;
        self.write_fixed_string(&header_bytes, 8)?;
        self.write_fixed_string(&reserved, 44)?;
        self.write_fixed_string(&num_data_records, 8)?;
        self.write_fixed_string(&duration_of_data_record, 8)?;
        self.write_fixed_string(&num_signals, 4)?;

        // Write signal headers (256 bytes per signal) - clone to avoid borrow issues
        let signal_headers = self.signal_headers.clone();

        for sh in &signal_headers {
            self.write_fixed_string(&sh.label, 16)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.transducer_type, 80)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.physical_dimension, 8)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.physical_minimum.to_string(), 8)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.physical_maximum.to_string(), 8)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.digital_minimum.to_string(), 8)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.digital_maximum.to_string(), 8)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.prefiltering, 80)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.num_samples_per_record.to_string(), 8)?;
        }
        for sh in &signal_headers {
            self.write_fixed_string(&sh.reserved, 32)?;
        }

        Ok(())
    }

    pub fn write_physical_record(&mut self, physical_data: &[Vec<f64>]) -> Result<(), String> {
        if physical_data.len() != self.signal_headers.len() {
            return Err(format!(
                "Expected {} signals, got {}",
                self.signal_headers.len(),
                physical_data.len()
            ));
        }

        // Parallel conversion of physical to digital, then sequential write
        let digital_data: Result<Vec<Vec<i16>>, String> = physical_data
            .par_iter()
            .enumerate()
            .map(|(signal_idx, physical_samples)| {
                let signal_header = &self.signal_headers[signal_idx];

                if physical_samples.len() != signal_header.num_samples_per_record {
                    return Err(format!(
                        "Signal {} expected {} samples, got {}",
                        signal_idx,
                        signal_header.num_samples_per_record,
                        physical_samples.len()
                    ));
                }

                let gain = signal_header.gain();
                let offset = signal_header.offset();

                Ok(physical_samples
                    .iter()
                    .map(|&physical| ((physical - offset) / gain).round() as i16)
                    .collect())
            })
            .collect();

        let digital_data = digital_data?;

        // Sequential write (I/O bound)
        for digital_samples in digital_data {
            for digital in digital_samples {
                let bytes = digital.to_le_bytes();
                self.file
                    .write_all(&bytes)
                    .map_err(|e| format!("Failed to write sample: {}", e))?;
            }
        }

        Ok(())
    }

    pub fn finalize(mut self, num_records_written: i64) -> Result<(), String> {
        // Update the number of data records in the header
        self.file
            .seek(SeekFrom::Start(236))
            .map_err(|e| format!("Failed to seek to update header: {}", e))?;

        self.write_fixed_string(&num_records_written.to_string(), 8)?;

        self.file
            .flush()
            .map_err(|e| format!("Failed to flush file: {}", e))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signal_header_calculations() {
        let header = EDFSignalHeader {
            label: "Test".to_string(),
            transducer_type: "".to_string(),
            physical_dimension: "uV".to_string(),
            physical_minimum: -100.0,
            physical_maximum: 100.0,
            digital_minimum: -32768,
            digital_maximum: 32767,
            prefiltering: "".to_string(),
            num_samples_per_record: 256,
            reserved: "".to_string(),
        };

        let sample_freq = header.sample_frequency(1.0);
        assert_eq!(sample_freq, 256.0);

        let gain = header.gain();
        assert!((gain - 0.00305).abs() < 0.001);
    }
}
