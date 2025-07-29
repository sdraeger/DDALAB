import { cn } from "../../lib/utils/misc";
import { useCallback, useEffect, useRef, useState } from "react";

interface EditableTitleProps {
	title: string;
	onTitleChange?: (newTitle: string) => void;
	className?: string;
}

export function EditableTitle({ title, onTitleChange, className }: EditableTitleProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(title);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleDoubleClick = useCallback((e: React.MouseEvent) => {
		// Prevent drag when double-clicking to edit title
		e.stopPropagation();

		if (onTitleChange) {
			setIsEditing(true);
			setEditValue(title);
		}
	}, [title, onTitleChange]);

	const handleSubmit = useCallback(() => {
		if (editValue.trim() && editValue !== title) {
			onTitleChange?.(editValue.trim());
		}
		setIsEditing(false);
	}, [editValue, title, onTitleChange]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			handleSubmit();
		} else if (e.key === 'Escape') {
			setEditValue(title);
			setIsEditing(false);
		}
	}, [handleSubmit, title]);

	// Select all text when editing starts
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.select();
		}
	}, [isEditing]);

	if (isEditing) {
		return (
			<input
				ref={inputRef}
				type="text"
				value={editValue}
				onChange={(e) => setEditValue(e.target.value)}
				onBlur={handleSubmit}
				onKeyDown={handleKeyDown}
				onMouseDown={(e) => {
					// Prevent drag when interacting with input field
					e.stopPropagation();
				}}
				onFocus={(e) => {
					// Prevent drag when focusing input field
					e.stopPropagation();
				}}
				className="bg-transparent border-none outline-none text-sm font-medium w-full"
				autoFocus
			/>
		);
	}

	return (
		<span
			className={cn(className, onTitleChange && 'cursor-pointer hover:text-primary')}
			onDoubleClick={handleDoubleClick}
			title={onTitleChange ? 'Double-click to edit' : undefined}
		>
			{title}
		</span>
	);
}
