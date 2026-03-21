import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { LibroContableController } from './libro-contable.controller';
import { LibroContableService } from './libro-contable.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LibroContableController],
  providers: [LibroContableService],
  exports: [LibroContableService],
})
export class LibroContableModule {}
