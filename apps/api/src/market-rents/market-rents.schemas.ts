import { z } from 'zod';

/** The property's address as RentCast reads it: "Street, City, State, Zip" (T-158). */
export const propertyAddressSchema = z.strictObject({ address: z.string().trim().min(5).max(200) });
export type PropertyAddressBody = z.infer<typeof propertyAddressSchema>;
