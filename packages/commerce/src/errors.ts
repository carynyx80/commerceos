/** Domain error carrying an HTTP status and a stable code. The API maps it to a response. */
export class CommerceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
