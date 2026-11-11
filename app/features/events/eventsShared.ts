import type {DroneEvent, EventParticipantStatus} from '../../../src/services/eventService';

export const MAX_EVENT_IMAGES = 4;
export const MAX_EVENT_LINKS = 8;
export const MAX_EVENT_CHECKLIST_ITEMS = 20;

const padDatePart = (value: number) => String(value).padStart(2, '0');

export const formatDateInput = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

export const formatTimeInput = (date: Date) =>
  `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

export const parseEventDateTime = (dateInput: string, timeInput: string) => {
  const normalizedDate = dateInput.trim();
  const normalizedTime = timeInput.trim();
  const match = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = normalizedTime.match(/^(\d{2}):(\d{2})$/);
  if (!match || !timeMatch) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hours ||
    parsed.getMinutes() !== minutes
  ) {
    return null;
  }

  return parsed;
};

export const formatEventDateTime = (
  event: Pick<DroneEvent, 'startsAt' | 'startsAtMs'>,
  locale?: string,
) => {
  const rawDate =
    typeof (event.startsAt as any)?.toDate === 'function'
      ? (event.startsAt as any).toDate()
      : new Date(event.startsAtMs);
  if (!(rawDate instanceof Date) || Number.isNaN(rawDate.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale || 'es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(rawDate);
};

export const getParticipantStatusTone = (status?: EventParticipantStatus | null) => {
  if (status === 'host') {
    return '#7c3aed';
  }
  if (status === 'going') {
    return '#059669';
  }
  if (status === 'invited') {
    return '#2563eb';
  }
  if (status === 'requested') {
    return '#d97706';
  }
  return '#64748b';
};

export const isValidCoordinate = (value?: {latitude?: number; longitude?: number} | null) =>
  Boolean(
    value &&
      typeof value.latitude === 'number' &&
      typeof value.longitude === 'number',
  );
