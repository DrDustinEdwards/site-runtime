export {
  ACCOUNT_WORDS,
  DISPOSABLE_EMAIL,
  EMAIL_CHANGE_EXPIRES_IN_SECONDS,
  EMAIL_CHANGE_EXPIRES_IN_WORDS,
  SIGN_IN_WORDS,
  emailLinkWords,
  passkeyErrorWords,
  securityHistoryWords,
  signInErrorWords,
} from "./sign-in-words.mjs";

/** True when the address is at a disposable domain or a subdomain of one. */
export function isDisposableEmail(email: string): boolean;

/** Better Auth's user create hook that refuses a disposable address (BAD_REQUEST `disposable_email`). */
export function refuseDisposable(user: { email: string }): Promise<void>;

/**
 * Where a sign-in may land: a path on this site, or `fallback` (default "/"). With `within`, only those paths and paths
 * under them.
 */
export function safeNextPath(
  raw: unknown,
  options?: { fallback?: string; within?: readonly string[] },
): string;

export type AuthLike = {
  handler: (request: Request) => Promise<Response>;
  options?: { baseURL?: unknown; basePath?: string };
};

export type LinkResult =
  | "sent"
  | "limited"
  | "email-limited"
  | "check-failed"
  | "unavailable"
  | "failed";
export type CodeRefusal =
  | "wrong"
  | "expired"
  | "spent"
  | "limited"
  | "email-limited"
  | "unavailable"
  | "disposable"
  | "failed";

/** Asks Better Auth for the sign-in mail through its handler (its limiter and Turnstile check run). */
export function requestSignInLink(
  auth: AuthLike,
  request: Request,
  link: {
    email: string;
    captchaToken?: string;
    callbackURL: string;
    newUserCallbackURL?: string;
    errorCallbackURL?: string;
  },
): Promise<LinkResult>;

/** Signs this browser in with the six-digit code; on success, only the session's Set-Cookie headers. */
export function signInWithCode(
  auth: AuthLike,
  request: Request,
  attempt: { email: string; code: string },
): Promise<{ status: "signed-in"; headers: Headers } | { status: CodeRefusal }>;

/** The form field that says the post is a typed code. */
export const SIGN_IN_INTENT: "intent";

/** What the sign-in page shows after its action. */
export type SignInFormState = {
  sent: string | null;
  error: string | null;
  codeError: string | null;
};

/** The sign-in page's whole action: a typed code (`intent=code`) or a link request. */
export function signInFormAction(
  auth: AuthLike,
  request: Request,
  form: FormData,
  site: {
    landing: (next: string) => string;
    newUserLanding?: (next: string) => string;
    errorLanding?: string;
    next?: { fallback?: string; within?: readonly string[] };
  },
): Promise<{ location: string; headers: Headers } | { state: SignInFormState; status: number }>;

/** Starts a Google or Apple sign-in from the page's form POST; null when the provider is not set up. */
export function startSocialSignIn(
  auth: AuthLike & {
    api: {
      signInSocial: (input: {
        body: {
          provider: string;
          callbackURL: string;
          newUserCallbackURL: string;
          errorCallbackURL: string;
        };
        headers: Headers;
        asResponse: true;
      }) => Promise<Response>;
    };
  },
  request: Request,
  start: {
    provider: string;
    callbackURL: string;
    newUserCallbackURL?: string;
    errorCallbackURL: string;
  },
): Promise<{ location: string; headers: Headers } | null>;

/** Better Auth's /api/auth/* answer, marked no-store when it says nothing about caching. */
export function authHandler(auth: AuthLike, request: Request): Promise<Response>;

export type SendEmailChange = (mail: {
  to: string;
  link: string;
  token: string;
  step: "current" | "new";
  newEmail?: string;
  expiresIn: string;
}) => Promise<void> | void;

/** Email change and account deletion options, the same on every site; spread beside `signInOptions`. */
export function accountOptions(site: {
  confirmPath: string;
  sendEmailChange: SendEmailChange;
  beforeDelete: (user: { id: string; email: string }) => Promise<void>;
}): {
  disabledPaths: string[];
  user: {
    changeEmail: {
      enabled: true;
      sendChangeEmailConfirmation: (data: {
        user: { email: string };
        newEmail: string;
        url: string;
        token: string;
      }) => Promise<void>;
    };
    deleteUser: {
      enabled: true;
      beforeDelete: (user: { id: string; email: string }) => Promise<void>;
    };
  };
  emailVerification: {
    expiresIn: number;
    sendVerificationEmail: (data: {
      user: { email: string };
      url: string;
      token: string;
    }) => Promise<void>;
  };
};

/** The account page's posts `accountFormAction` answers, by their `intent` field. */
export const ACCOUNT_INTENTS: readonly ["change-email", "sign-out-device", "delete-account"];

/** What the account page shows after one of its posts. */
export type AccountFormState = {
  intent: string;
  ok: boolean;
  error: string | null;
  /** The post needs a sign-in from the last FRESH_SECONDS first. */
  stale: boolean;
  /** The current address the first email-change link went to. */
  sentTo: string | null;
};

export type AccountUser = { id: string; email: string; emailVerified?: boolean };

/** The part of Better Auth's `auth.api` the account page's posts use. */
export type AccountApi = {
  getSession(
    o: import("./sign-in-account.mjs").SessionLookup,
  ): Promise<{ session: { createdAt: Date | string; token: string }; user: AccountUser } | null>;
  listSessions(o: { headers: Headers }): Promise<import("./sign-in-account.mjs").SessionRow[]>;
  revokeSession(o: { headers: Headers; body: { token: string } }): Promise<unknown>;
  changeEmail(o: { headers: Headers; body: { newEmail: string } }): Promise<unknown>;
  deleteUser(o: {
    headers: Headers;
    body: Record<string, never>;
    asResponse: true;
  }): Promise<Response>;
};

/**
 * The account page's posts, the same on every site: `intent=change-email` (`newEmail`), `intent=sign-out-device`
 * (`session`, an id) and `intent=delete-account` (`confirm`). Null for any other intent, for the site's own posts.
 * `beforeDelete` is the site's own step before Better Auth deletes the person; a string it returns is the refusal.
 */
export function accountFormAction(
  auth: { api: AccountApi },
  request: Request,
  form: FormData,
  site: {
    deletedLanding: string;
    beforeDelete?: (user: AccountUser, form: FormData) => Promise<string | null | undefined>;
  },
): Promise<
  { location: string; headers: Headers } | { state: AccountFormState; status: number } | null
>;
