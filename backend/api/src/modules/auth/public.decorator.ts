import { SetMetadata } from "@nestjs/common";
import { IS_PUBLIC } from "./jwt-auth.guard";

/** Login and the health probe are the only routes that cannot require a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
