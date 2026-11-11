/** Whether the request says the person confirmed: `confirmed=1`, and the typed word (any case, trimmed) when asked for. */
export function confirmationSatisfied(form: { get(name: string): unknown }, word?: string): boolean;
/** The refusal for a destructive request that was not confirmed: a 400 that says nothing was changed. */
export function confirmationRequired(): Response;
