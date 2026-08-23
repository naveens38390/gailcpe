import { Body, Controller, Get, Ip, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { Public } from "./public.decorator";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post("login")
  @ApiOperation({ summary: "Exchange credentials for an access token" })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  @Get("me")
  @ApiOperation({ summary: "The signed-in user and their role" })
  me(@Req() req: any) {
    return req.user;
  }
}
