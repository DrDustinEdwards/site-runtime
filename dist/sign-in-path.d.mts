/**
 * Where every site's sign-in pages live. Apart from `./sign-in` and `./sign-in-client` so a page or a link can name them
 * without pulling Better Auth into its bundle; both re-export them.
 */
/** Where every site's sign-in page lives: "/login". */
export const SIGN_IN_PATH: "/login";
/** Where the mailed sign-in link opens unless the site names another page: "/sign-in/confirm". */
export const CONFIRM_PATH: "/sign-in/confirm";
