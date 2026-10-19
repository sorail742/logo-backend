export const GENERATION_QUEUE = 'generation';
export const EMAIL_QUEUE = 'emails';
export const MAINTENANCE_QUEUE = 'maintenance';

/** Tentatives avant passage en FAILED et remboursement (§11.4). */
export const GENERATION_ATTEMPTS = 3;

export interface GenerationJobData {
  jobId: string;
}

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const jobEventsChannel = (jobId: string) => `job-events:${jobId}`;
