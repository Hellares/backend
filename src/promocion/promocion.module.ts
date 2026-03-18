import { Module } from '@nestjs/common';
import { PromocionController } from './promocion.controller';
import { PromocionService } from './promocion.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PromocionController],
  providers: [PromocionService],
  exports: [PromocionService],
})
export class PromocionModule {}
