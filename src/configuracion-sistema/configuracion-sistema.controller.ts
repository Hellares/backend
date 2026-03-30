import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminService } from '../admin/admin.service';

@ApiTags('Configuracion Sistema')
@Controller('configuracion-sistema')
export class ConfiguracionSistemaController {
  constructor(private readonly adminService: AdminService) {}

  @Get('publica')
  async getConfiguracionPublica() {
    return this.adminService.getConfiguracionPublica();
  }
}
