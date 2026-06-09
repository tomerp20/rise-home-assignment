import serverlessHttp from 'serverless-http';
import { createApp } from './app';
import { CampaignService } from './campaigns/campaign.service';
import { DynamoDBCampaignRepository } from './campaigns/campaign.repository.dynamodb';

const campaignService = new CampaignService(new DynamoDBCampaignRepository());
const app = createApp({ campaignService }); // no db — DynamoDB mode

export const handler = serverlessHttp(app);
