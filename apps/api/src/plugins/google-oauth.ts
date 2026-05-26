import fp from "fastify-plugin"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { config } from "../config.js"

export interface GoogleIdTokenClaims {
  sub: string
  name?: string
  picture?: string
  email?: string
}

export interface GoogleOAuthClient {
  buildAuthorizeUrl(args: {
    state: string
    codeChallenge: string
    redirectUri: string
  }): string

  exchangeCode(args: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<{ idToken: string }>

  verifyIdToken(idToken: string): Promise<GoogleIdTokenClaims>
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))

class GoogleOAuthClientImpl implements GoogleOAuthClient {
  buildAuthorizeUrl({
    state,
    codeChallenge,
    redirectUri,
  }: {
    state: string
    codeChallenge: string
    redirectUri: string
  }): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.GOOGLE_OAUTH_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  async exchangeCode({
    code,
    codeVerifier,
    redirectUri,
  }: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<{ idToken: string }> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      code_verifier: codeVerifier,
    })

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Google token exchange failed: ${res.status} ${text}`)
    }

    const json = (await res.json()) as { id_token?: string }
    if (!json.id_token) {
      throw new Error("Google token response missing id_token")
    }
    return { idToken: json.id_token }
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdTokenClaims> {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: config.GOOGLE_OAUTH_CLIENT_ID,
    })
    return {
      sub: payload.sub as string,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
      email: payload.email as string | undefined,
    }
  }
}

declare module "fastify" {
  interface FastifyInstance {
    googleOAuth: GoogleOAuthClient
  }
}

export const googleOAuthPlugin = fp(
  async (app) => {
    app.decorate("googleOAuth", new GoogleOAuthClientImpl())
  },
  { name: "google-oauth" },
)
