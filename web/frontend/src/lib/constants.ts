export const VALID_LANGUAGES = [
  'ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en',
  'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'ht', 'hu', 'id',
  'is', 'it', 'ja', 'ko', 'la', 'lt', 'ms', 'ne', 'nl', 'no',
  'pa', 'pl', 'pt', 'ro', 'ru', 'sa', 'sk', 'sr', 'sv', 'sw',
  'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yue', 'zh',
  'unknown',
];

export const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic', az: 'Azerbaijani', bg: 'Bulgarian', bn: 'Bengali', ca: 'Catalan',
  cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English',
  es: 'Spanish', fa: 'Persian', fi: 'Finnish', fr: 'French', he: 'Hebrew',
  hi: 'Hindi', hr: 'Croatian', ht: 'Haitian', hu: 'Hungarian', id: 'Indonesian',
  is: 'Icelandic', it: 'Italian', ja: 'Japanese', ko: 'Korean', la: 'Latin',
  lt: 'Lithuanian', ms: 'Malay', ne: 'Nepali', nl: 'Dutch', no: 'Norwegian',
  pa: 'Punjabi', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian',
  sa: 'Sanskrit', sk: 'Slovak', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili',
  ta: 'Tamil', te: 'Telugu', th: 'Thai', tl: 'Tagalog', tr: 'Turkish',
  uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', yue: 'Cantonese', zh: 'Chinese',
  unknown: 'Unknown/Any',
};

export const TASK_TYPES = ['text2music', 'repaint', 'cover', 'extract', 'lego', 'complete'];
export const TASK_TYPES_TURBO = ['text2music', 'repaint', 'cover'];

export const TASK_INSTRUCTIONS: Record<string, string> = {
  text2music: 'Fill the audio semantic mask based on the given conditions:',
  repaint: 'Repaint the mask area based on the given conditions:',
  cover: 'Generate audio semantic tokens based on the given conditions:',
  extract: 'Extract the {TRACK_NAME} track from the audio:',
  lego: 'Generate the {TRACK_NAME} track based on the audio context:',
  complete: 'Complete the input track with {TRACK_CLASSES}:',
};

export const TRACK_NAMES = [
  'woodwinds', 'brass', 'fx', 'synth', 'strings', 'percussion',
  'keyboard', 'guitar', 'bass', 'drums', 'backing_vocals', 'vocals',
];

export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '6/8'];
export const BPM_MIN = 30;
export const BPM_MAX = 300;
export const DURATION_MIN = 10;
export const DURATION_MAX = 600;
export const AUDIO_FORMATS = ['flac', 'mp3', 'wav'];
export const INFER_METHODS = ['ode', 'sde'];
