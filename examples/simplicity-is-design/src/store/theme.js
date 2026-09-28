import { Store } from 'valen';

// true = persists to localStorage
export const Theme = Store('$theme', { inverted: false }, true);