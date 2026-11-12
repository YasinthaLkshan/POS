import { z } from 'zod';

const sessionSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.number(),
  user: z.object({ id: z.uuid(), shopId: z.uuid() }),
});
type Session = z.infer<typeof sessionSchema>;
interface Storage {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

/** API session is encrypted by Electron's Windows secure storage adapter. */
export class ApiSession {
  private session: Session | null;
  constructor(
    private apiUrl: string,
    private storage: Storage,
    private transport: typeof fetch = fetch,
  ) {
    try {
      const saved = storage.read();
      this.session = saved ? sessionSchema.parse(JSON.parse(saved)) : null;
    } catch {
      this.session = null;
      storage.clear();
    }
  }
  async signInWithPassword(input: { username: string; password: string }) {
    try {
      const response = await this.transport(`${this.apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const result = (await response.json()) as {
        data?: { token: string; expiresAt: string; user: Session['user'] };
        error?: { message: string };
      };
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? 'Sign-in failed');
      this.session = sessionSchema.parse({
        access_token: result.data.token,
        expires_at: new Date(result.data.expiresAt).getTime(),
        user: result.data.user,
      });
      this.storage.write(JSON.stringify(this.session));
      return { error: null };
    } catch (error) {
      return { error: { message: error instanceof Error ? error.message : 'Sign-in failed' } };
    }
  }
  async getSession() {
    if (this.session && this.session.expires_at <= Date.now()) {
      this.session = null;
      this.storage.clear();
    }
    return { data: { session: this.session }, error: null };
  }
  async signOut() {
    const token = this.session?.access_token;
    this.session = null;
    this.storage.clear();
    if (token)
      await this.transport(`${this.apiUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      }).catch(() => undefined);
    return { error: null };
  }
  async updateUser(input: { currentPassword: string; newPassword: string }) {
    try {
      const { data } = await this.getSession();
      if (!data.session) throw new Error('Sign in to continue');
      const response = await this.transport(`${this.apiUrl}/api/v1/auth/password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const result = (await response.json()) as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Password change failed');
      this.session = null;
      this.storage.clear();
      return { error: null };
    } catch (error) {
      return {
        error: { message: error instanceof Error ? error.message : 'Password change failed' },
      };
    }
  }
}
