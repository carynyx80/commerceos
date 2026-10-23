import type { ZodTypeAny, z } from "zod";

/** Parse untrusted input with a shared zod schema; ZodError is mapped to 400 by ErrorFilter. */
export function parse<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}
