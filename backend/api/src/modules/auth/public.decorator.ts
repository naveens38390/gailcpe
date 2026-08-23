import { SetMetadata } from "@nestjs/common";
import { IS_PUBLIC } from "./jwt-auth.guard";

/** Login is the only route that cannot require a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
