// Auth.js catch-all route — delegates to the NextAuth handlers.
import { handlers } from '../../../../auth.js';

export const { GET, POST } = handlers;
