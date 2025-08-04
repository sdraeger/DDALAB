import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ className = '', children, ...props }) => {
	return (
		<div className={`rounded-lg border bg-card text-card-foreground shadow-sm ${className}`} {...props}>
			{children}
		</div>
	);
};

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ className = '', children, ...props }) => {
	return (
		<div className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props}>
			{children}
		</div>
	);
};

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
	children: React.ReactNode;
}

export const CardTitle: React.FC<CardTitleProps> = ({ className = '', children, ...props }) => {
	return (
		<h3 className={`text-2xl font-semibold leading-none tracking-tight ${className}`} {...props}>
			{children}
		</h3>
	);
};

interface CardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
	children: React.ReactNode;
}

export const CardDescription: React.FC<CardDescriptionProps> = ({ className = '', children, ...props }) => {
	return (
		<p className={`text-sm text-muted-foreground ${className}`} {...props}>
			{children}
		</p>
	);
};

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode;
}

export const CardContent: React.FC<CardContentProps> = ({ className = '', children, ...props }) => {
	return (
		<div className={`p-6 pt-0 ${className}`} {...props}>
			{children}
		</div>
	);
}; 