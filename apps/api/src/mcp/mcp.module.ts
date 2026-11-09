import { Module, type DynamicModule } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

/**
 * The MCP server (T-084). It is given the app's own module instances (OAuth, valuation,
 * Foresight), so its tools call exactly the services the REST API calls. Findings and
 * phases are global.
 */
@Module({})
export class McpModule {
  static register(shared: { oauth: DynamicModule; valuation: DynamicModule; foresight: DynamicModule }): DynamicModule {
    return {
      module: McpModule,
      imports: [DealsModule, EvidenceModule, shared.oauth, shared.valuation, shared.foresight],
      controllers: [McpController],
      providers: [McpService],
    };
  }
}
