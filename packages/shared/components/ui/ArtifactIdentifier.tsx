import React from "react";
import { Badge } from "./badge";
import { Card, CardContent } from "./card";
import { Clock, User, FileText, Share2 } from "lucide-react";
import { cn } from "../../lib/utils/misc";

export interface ArtifactInfo {
	artifact_id: string;
	name: string;
	file_path: string;
	created_at: string;
	user_id: number;
	shared_by_user_id?: number;
}

interface ArtifactIdentifierProps {
	artifact: ArtifactInfo;
	className?: string;
	variant?: "header" | "badge" | "card" | "compact";
	showDetails?: boolean;
}

export function ArtifactIdentifier({
	artifact,
	className,
	variant = "header",
	showDetails = true,
}: ArtifactIdentifierProps) {
	const formatDate = (dateString: string) => {
		try {
			return new Date(dateString).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return dateString;
		}
	};

	const getArtifactName = () => {
		return artifact.name || `Artifact ${artifact.artifact_id.slice(0, 8)}`;
	};

	if (variant === "badge") {
		return (
			<Badge variant="secondary" className={cn("text-xs", className)}>
				<FileText className="h-3 w-3 mr-1" />
				{getArtifactName()}
			</Badge>
		);
	}

	if (variant === "compact") {
		return (
			<div className={cn("flex items-center gap-2 text-sm", className)}>
				<Badge variant="outline" className="text-xs">
					<FileText className="h-3 w-3 mr-1" />
					{getArtifactName()}
				</Badge>
				{artifact.shared_by_user_id && (
					<Badge variant="secondary" className="text-xs">
						<Share2 className="h-3 w-3 mr-1" />
						Shared
					</Badge>
				)}
			</div>
		);
	}

	if (variant === "card") {
		return (
			<Card className={cn("", className)}>
				<CardContent className="p-3">
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<h4 className="font-medium text-sm">{getArtifactName()}</h4>
							{artifact.shared_by_user_id && (
								<Badge variant="secondary" className="text-xs">
									<Share2 className="h-3 w-3 mr-1" />
									Shared
								</Badge>
							)}
						</div>
						{showDetails && (
							<div className="space-y-1 text-xs text-muted-foreground">
								<div className="flex items-center gap-1">
									<FileText className="h-3 w-3" />
									<span className="truncate">{artifact.file_path}</span>
								</div>
								<div className="flex items-center gap-1">
									<Clock className="h-3 w-3" />
									<span>{formatDate(artifact.created_at)}</span>
								</div>
								<div className="flex items-center gap-1">
									<User className="h-3 w-3" />
									<span>
										{artifact.shared_by_user_id
											? `Shared by User ${artifact.shared_by_user_id}`
											: `User ${artifact.user_id}`}
									</span>
								</div>
							</div>
						)}
					</div>
				</CardContent>
			</Card>
		);
	}

	// Default "header" variant
	return (
		<div className={cn("flex flex-col gap-1 p-2 bg-muted/30 border-b", className)}>
			<div className="flex items-center justify-between">
				<h3 className="font-medium text-sm">{getArtifactName()}</h3>
				<div className="flex items-center gap-2">
					{artifact.shared_by_user_id && (
						<Badge variant="secondary" className="text-xs">
							<Share2 className="h-3 w-3 mr-1" />
							Shared
						</Badge>
					)}
					<Badge variant="outline" className="text-xs">
						ID: {artifact.artifact_id.slice(0, 8)}
					</Badge>
				</div>
			</div>
			{showDetails && (
				<div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
					<div className="flex items-center gap-1">
						<FileText className="h-3 w-3" />
						<span className="truncate max-w-[200px]">{artifact.file_path}</span>
					</div>
					<div className="flex items-center gap-1">
						<Clock className="h-3 w-3" />
						<span>{formatDate(artifact.created_at)}</span>
					</div>
					<div className="flex items-center gap-1">
						<User className="h-3 w-3" />
						<span>
							{artifact.shared_by_user_id
								? `Shared by User ${artifact.shared_by_user_id}`
								: `User ${artifact.user_id}`}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
