import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, WorkspaceKind, WorkspaceRole } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, sha256 } from '../../common/utils/crypto.util';
import { uniqueSlug } from '../../common/utils/slug.util';
import { MailService } from '../mail/mail.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { SessionMeta, SessionService } from './session.service';

type ActionPurpose = 'verify-email' | 'reset-password';

interface ActionPayload {
  sub: string;
  purpose: ActionPurpose;
  /** Empreinte du hachage courant : le lien devient invalide dès que le mot de passe change. */
  ph?: string;
}

const PENDING_TOTP_TTL_S = 600;
/** Codes de secours à usage unique remis à l'activation de la 2FA (§14.1). */
const BACKUP_CODE_COUNT = 10;
/** Base 32 de Crockford : ni i, l, o, u, pour éviter les confusions à la saisie. */
const BACKUP_CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

@Injectable()
export class AuthService {
  private readonly google: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.google = new OAuth2Client(this.config.get<string>('GOOGLE_CLIENT_ID'));
  }

  // ─── Inscription et connexion ───

  async register(dto: RegisterDto, meta: SessionMeta) {
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Un compte existe déjà avec cette adresse');
    }
    await this.passwords.assertStrong(dto.password);
    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, fullName: dto.fullName, locale: dto.locale ?? 'fr' },
      });
      await this.createPersonalWorkspace(tx, created);
      return created;
    });

    await this.mail.sendEmailVerification(email, await this.actionToken(user, 'verify-email', '2d'));
    return this.sessions.issue(user, false, meta);
  }

  async login(dto: LoginDto, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Même message et même coût de calcul que le compte existe ou non.
    const ok = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : (await this.passwords.hash(dto.password), false);
    if (!user || !ok || user.deletedAt) throw new UnauthorizedException('Identifiants invalides');
    if (user.suspendedAt) throw new UnauthorizedException('Compte suspendu');

    const mfa = await this.checkTotp(user, dto.totpCode);
    return this.sessions.issue(user, mfa, meta);
  }

  async loginWithGoogle(idToken: string, totpCode: string | undefined, meta: SessionMeta) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) throw new BadRequestException('Connexion Google non configurée');

    const ticket = await this.google
      .verifyIdToken({ idToken, audience: clientId })
      .catch(() => {
        throw new UnauthorizedException('Jeton Google invalide');
      });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || !p.email_verified) {
      throw new UnauthorizedException('Adresse Google non vérifiée');
    }

    const account = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: p.sub } },
      include: { user: true },
    });

    let user: User;
    if (account) {
      user = account.user;
    } else {
      const email = p.email.toLowerCase();
      user = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        const u =
          existing ??
          (await tx.user.create({
            data: {
              email,
              fullName: p.name ?? email.split('@')[0],
              avatarUrl: p.picture,
              emailVerifiedAt: new Date(),
              locale: p.locale?.startsWith('en') ? 'en' : 'fr',
            },
          }));
        if (!existing) await this.createPersonalWorkspace(tx, u);
        else if (!existing.emailVerifiedAt) {
          await tx.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
        }
        await tx.oAuthAccount.create({
          data: { userId: u.id, provider: 'google', providerAccountId: p.sub },
        });
        return u;
      });
    }

    if (user.deletedAt || user.suspendedAt) throw new UnauthorizedException('Compte indisponible');
    const mfa = await this.checkTotp(user, totpCode);
    return this.sessions.issue(user, mfa, meta);
  }

  /** Espace personnel créé à l'inscription (PRJ-01). */
  async createPersonalWorkspace(tx: Tx, user: Pick<User, 'id' | 'fullName'>) {
    return tx.workspace.create({
      data: {
        name: `Espace de ${user.fullName}`,
        slug: uniqueSlug(user.fullName),
        kind: WorkspaceKind.PERSONAL,
        members: { create: { userId: user.id, role: WorkspaceRole.OWNER } },
      },
    });
  }

  // ─── Vérification d'e-mail et mot de passe oublié ───

  async verifyEmail(token: string) {
    const payload = await this.readActionToken(token, 'verify-email');
    await this.prisma.user.updateMany({
      where: { id: payload.sub, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Réponse identique que le compte existe ou non (pas d'énumération des comptes).
    if (!user || user.deletedAt || !user.email) return;
    await this.mail.sendPasswordReset(user.email, await this.actionToken(user, 'reset-password', '30m'));
  }

  async resetPassword(token: string, password: string) {
    const payload = await this.readActionToken(token, 'reset-password');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || fingerprint(user.passwordHash) !== payload.ph) {
      throw new BadRequestException('Lien invalide ou déjà utilisé');
    }
    await this.passwords.assertStrong(password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(password) },
    });
    await this.sessions.revokeAll(user.id);
  }

  private actionToken(
    user: Pick<User, 'id' | 'passwordHash'>,
    purpose: ActionPurpose,
    ttl: '2d' | '30m',
  ) {
    const payload: ActionPayload = { sub: user.id, purpose };
    if (purpose === 'reset-password') payload.ph = fingerprint(user.passwordHash);
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACTION_SECRET'),
      expiresIn: ttl,
    });
  }

  private async readActionToken(token: string, purpose: ActionPurpose): Promise<ActionPayload> {
    try {
      const payload = await this.jwt.verifyAsync<ActionPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACTION_SECRET'),
      });
      if (payload.purpose !== purpose) throw new Error('purpose');
      return payload;
    } catch {
      throw new BadRequestException('Lien invalide ou expiré');
    }
  }

  // ─── Double authentification TOTP (CPT-05) ───

  async setupTotp(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpSecret) throw new ConflictException('La double authentification est déjà active');
    const secret = authenticator.generateSecret();
    // Le secret n'est enregistré en base qu'après confirmation d'un premier code.
    await this.redis.set(`totp-pending:${userId}`, secret, 'EX', PENDING_TOTP_TTL_S);
    return {
      secret,
      otpauthUrl: authenticator.keyuri(user.email ?? user.phone ?? user.id, 'Plateforme', secret),
    };
  }

  async confirmTotp(userId: string, code: string, meta: SessionMeta) {
    const secret = await this.redis.get(`totp-pending:${userId}`);
    if (!secret) throw new BadRequestException('Aucune activation en cours, recommencez');
    if (!authenticator.verify({ token: code, secret })) {
      throw new BadRequestException('Code incorrect');
    }
    // Codes de secours affichés une seule fois ; seules leurs empreintes sont conservées.
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const chars = [...randomBytes(8)].map((b) => BACKUP_CODE_ALPHABET[b & 31]).join('');
      return `${chars.slice(0, 4)}-${chars.slice(4)}`;
    });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encrypt(secret, this.totpKey()), totpBackupCodes: backupCodes.map(sha256) },
    });
    await this.redis.del(`totp-pending:${userId}`);
    // Nouvelle session marquée mfa pour accéder immédiatement aux routes protégées.
    return { session: await this.sessions.issue(user, true, meta), backupCodes };
  }

  /**
   * Renvoie vrai si un code TOTP ou un code de secours valide a été fourni ; lève une erreur si
   * la 2FA l'exige. Un code de secours est consommé.
   */
  private async checkTotp(user: User, code: string | undefined): Promise<boolean> {
    if (!user.totpSecret) return false;
    if (!code) {
      throw new UnauthorizedException({
        message: 'Code de double authentification requis',
        code: 'MFA_REQUIRED',
        mfaRequired: true,
      });
    }
    const secret = decrypt(user.totpSecret, this.totpKey());
    if (authenticator.verify({ token: code.replace(/\s/g, ''), secret })) return true;

    // Retrait atomique : un code de secours ne sert qu'une fois, même en cas de requêtes simultanées.
    const normalized = code.trim().toLowerCase().replace(/^([0-9a-z]{4})-?([0-9a-z]{4})$/, '$1-$2');
    const hash = sha256(normalized);
    const consumed = await this.prisma.$executeRaw`
      UPDATE "User" SET "totpBackupCodes" = array_remove("totpBackupCodes", ${hash})
      WHERE id = ${user.id} AND ${hash} = ANY("totpBackupCodes")`;
    if (consumed === 1) return true;
    throw new UnauthorizedException({ message: 'Code de double authentification incorrect', code: 'MFA_INVALID' });
  }

  private totpKey() {
    return this.config.getOrThrow<string>('TOTP_ENCRYPTION_KEY');
  }
}

function fingerprint(passwordHash: string | null): string {
  return sha256(passwordHash ?? 'no-password').slice(0, 16);
}
