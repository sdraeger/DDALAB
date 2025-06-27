"use client";

import React from "react";
import { useAppSelector } from "../../store";
import { LoadingOverlay } from "./loading-overlay";

export function GlobalLoadingOverlay() {
	const loadingState = useAppSelector(state => state.loading);

	if (!loadingState.showGlobalOverlay) {
		return null;
	}

	return (
		<LoadingOverlay
			show={true}
			message={loadingState.overlayMessage}
			progress={loadingState.overlayProgress}
			variant="fullscreen"
			size="lg"
		/>
	);
}
