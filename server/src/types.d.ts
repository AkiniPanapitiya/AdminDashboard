export interface AuthUser {
  id: string;
  email: string;
  role: 'owner';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
