import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import * as bcrypt from "bcryptjs";

import { AuditLog, User } from "../../database/schemas/activity.schema";

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(AuditLog.name) private audit: Model<AuditLog>,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    // Select the hash explicitly: the schema hides it from every other read.
    const user = await this.users
      .findOne({ email: email.toLowerCase(), active: true })
      .select("+passwordHash");

    // Same message either way. Telling an attacker which half was wrong turns
    // the login form into a directory of who works here.
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new UnauthorizedException("Email or password is incorrect.");

    user.lastLoginAt = new Date();
    await user.save();
    await this.audit.create({
      user: user._id,
      action: "login",
      ip,
      detail: { role: user.role },
    });

    return {
      accessToken: await this.jwt.signAsync({
        sub: String(user._id),
        email: user.email,
        role: user.role,
        name: user.name,
      }),
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
        territories: user.territories,
      },
    };
  }
}
