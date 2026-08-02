-- Belize Connect Jobs (M24) — employer↔applicant messaging reuses M17 conversations.
ALTER TYPE "ConversationParticipantRole" ADD VALUE 'EMPLOYER';
ALTER TYPE "ConversationParticipantRole" ADD VALUE 'APPLICANT';
