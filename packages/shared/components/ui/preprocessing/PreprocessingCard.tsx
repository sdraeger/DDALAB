"use client";

import React from "react";
import { UseFormReturn } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../card";
import { FormValues } from "../../form/DDAForm";
import { FilterOptionsGroup } from "./FilterOptionsGroup";
import { SignalProcessingGroup } from "./SignalProcessingGroup";
import { NormalizationGroup } from "./NormalizationGroup";

interface PreprocessingCardProps {
  form: UseFormReturn<FormValues>;
}

export function PreprocessingCard({ form }: PreprocessingCardProps) {
  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Preprocessing Options</CardTitle>
        <CardDescription>
          Configure signal preprocessing steps to enhance your EEG data quality.
          All options are applied automatically when you run DDA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Filtering Options */}
        <FilterOptionsGroup form={form} />

        {/* Signal Processing */}
        <SignalProcessingGroup form={form} />

        {/* Normalization */}
        <NormalizationGroup form={form} />
      </CardContent>
    </Card>
  );
}
