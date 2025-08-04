import React from 'react';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
	variant?: 'default' | 'destructive';
	children: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({
	variant = 'default',
	className = '',
	children,
	...props
}) => {
	const baseClasses = 'relative w-full rounded-lg border p-4';

	const variantClasses = {
		default: 'bg-background text-foreground',
		destructive: 'border-destructive/50 text-destructive dark:border-destructive'
	};

	const classes = `${baseClasses} ${variantClasses[variant]} ${className}`;

	return (
		<div className={classes} {...props}>
			{children}
		</div>
	);
};

interface AlertDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
	children: React.ReactNode;
}

export const AlertDescription: React.FC<AlertDescriptionProps> = ({ className = '', children, ...props }) => {
	return (
		<div className={`text-sm [&_p]:leading-relaxed ${className}`} {...props}>
			{children}
		</div>
	);
}; 