'use client';

import { DatasetBuilder } from '@/components/training/DatasetBuilder';
import { TrainingForm } from '@/components/training/TrainingForm';
import { TrainingProgress } from '@/components/training/TrainingProgress';

export default function TrainingPage() {
  return (
    <div className="max-w-[1200px] mx-auto space-y-4">
      <h1 className="text-xl font-bold">LoRA Training</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <DatasetBuilder />
        </div>
        <div className="space-y-4">
          <TrainingForm />
          <TrainingProgress />
        </div>
      </div>
    </div>
  );
}
