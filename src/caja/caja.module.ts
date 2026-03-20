import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CajaController],
  providers: [CajaService],
  exports: [CajaService],
})
export class CajaModule {}
