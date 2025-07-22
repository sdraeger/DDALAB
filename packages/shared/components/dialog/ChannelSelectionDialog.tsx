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

interface ChannelSelectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	filePath: string;
	onConfirm?: (filePath: string, selectedChannels: string[]) => void;
}

interface EdfMetadata {
	channels: string[];
	[key: string]: any;
}

export function ChannelSelectionDialog({ open, onOpenChange, filePath, onConfirm }: ChannelSelectionDialogProps) {
	const [metadata, setMetadata] = useState<EdfMetadata | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
	const [search, setSearch] = useState("");

	// Fetch metadata when dialog opens
	useEffect(() => {
		if (open && filePath) {
			setLoading(true);
			setError(null);
			fetch(`/api/edf/info?file_path=${encodeURIComponent(filePath)}`)
				.then(res => res.json())
				.then(data => {
					setMetadata(data);
					setSelectedChannels(data.channels?.slice(0, 5) || []);
				})
				.catch(err => setError(err.message || "Failed to fetch metadata"))
				.finally(() => setLoading(false));
		}
	}, [open, filePath]);

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

	// Confirm selection
	const handleConfirm = () => {
		if (onConfirm) onConfirm(filePath, selectedChannels);
		onOpenChange(false);
	};

	// Filtered channels
	const filteredChannels = metadata?.channels?.filter(c =>
		c.toLowerCase().includes(search.toLowerCase())
	) || [];

	// Show all metadata except channels
	const metaEntries = metadata ? Object.entries(metadata).filter(([k]) => k !== "channels") : [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Select Channels for EDF File</DialogTitle>
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
						<DialogFooter className="mt-4">
							<Button onClick={handleConfirm} disabled={selectedChannels.length === 0}>Confirm Selection</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
