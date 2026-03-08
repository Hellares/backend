import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ArchivingService } from './archiving.service';

@ApiTags('Archiving')
@Controller('admin/archiving')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ArchivingController {
  constructor(private readonly archivingService: ArchivingService) {}

  @Get('table-sizes')
  @ApiOperation({ summary: 'Get monitored table sizes and thresholds' })
  getTableSizes() {
    return this.archivingService.getTableSizes();
  }

  @Post('archive-orders')
  @ApiOperation({ summary: 'Manually trigger order archiving' })
  archiveOrders() {
    return this.archivingService.archiveOldOrders();
  }

  @Post('monitor')
  @ApiOperation({ summary: 'Manually trigger table size monitoring' })
  monitorTableSizes() {
    return this.archivingService.monitorTableSizes();
  }
}
