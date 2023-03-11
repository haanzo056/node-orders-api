import fjwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

const claimsSchema = z.object({ sub: z.string().uuid(), email: z.string().email() });

export interface AuthOptions {
  secret: string;
  issuer: string;
}

// Tokens are issued by the separate auth service (shared HS256 secret). We only verify.
export default fp<AuthOptions>(
  async (app, { secret, issuer }) => {
    await app.register(fjwt, {
      secret,
      sign: { iss: issuer, expiresIn: '1h' },
      verify: { allowedIss: issuer },
    });

    app.decorate('authenticate', async (req: FastifyRequest) => {
      try {
        await req.jwtVerify();
      } catch {
        throw new AppError(401, 'unauthorized', 'Missing or invalid access token');
      }
      if (!claimsSchema.safeParse(req.user).success) {
        throw new AppError(401, 'unauthorized', 'Token is missing required claims');
      }
    });
  },
  { name: 'auth' },
);
