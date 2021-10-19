import {Cluster} from "./resources/cluster";
import {VPC} from "./resources/vpc";
import {IClusterOptions} from "./options";
import Globals from "./core/Globals";
import BPromise = require('bluebird');
//
const PluginOptionsSchema = require('./options.json');
//
class ServerlessECSPlugin {
    private readonly serverless: any;
    //Plugin stub
    private readonly hooks: { [key: string]: Function };
    private readonly commands: object;
    private readonly provider: string;

    constructor(serverless: any, options: any) {
        this.serverless = serverless;
        // this.provider = 'aws';
        //Commands
        this.commands = {
            'serverless-ecs-plugin': {
                usage: 'serverless-ecs-plugin compile',
                commands: {
                    compile: {
                        type: 'entrypoint',
                        lifecycleEvents: ['compile'],
                    }
                }
            }
        };
        //Hooks
        this.hooks = {
            // Cmds
            'serverless-ecs-plugin:compile:compile': () => BPromise.bind(this).then(this.compile), //0
            // Real hooks
            'deploy:compileFunctions': () => {
                return BPromise.bind(this)
                    .then(() => this.serverless.pluginManager.spawn('serverless-ecs-plugin:compile'))
            }
        };
        //Schema
        this.serverless.configSchemaHandler.defineTopLevelProperty('ecs', PluginOptionsSchema);
    }

    private compile(): void {
        const service: any = this.serverless.service;
        //compatible with old serverless, new serverless (3.x) and hybridless hook
        const options: IClusterOptions[] = (this.serverless.pluginManager.serverlessConfigFile ? this.serverless.pluginManager.serverlessConfigFile.ecs : this.serverless.configurationInput.ecs) || this.serverless.service.ecs;
        const stage: string = service.provider ? service.provider.stage : service.stage;
        const provider = this.serverless.getProvider(Globals.PluginDefaultProvider);
        const serviceName: string = provider.naming.getNormalizedFunctionName(service.service.replace(/-/g, ''));
        //No cluster section specified, don't process
        if (!options || !options.length) {
            console.error('serverless-ecs-plugin: Cluster will not be deployed due missing options.');
            return;
        }
        //For each cluster
        for (let clusterOption of options) {
            if (clusterOption && clusterOption.vpc) { //sanity check for empty objects
                //multiple self-created VPCs will be a problem here, TODO: solve this with cluster prefix on resouces
                const vpc: VPC = new VPC(stage, clusterOption.vpc, clusterOption.tags);
                const cluster: Cluster = new Cluster(stage, clusterOption, vpc, serviceName, clusterOption.tags);
                // merge current cluster stuff into resources
                Object.assign(
                    this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
                    vpc.generate(),
                    cluster.generate()
                );
                // merge current cluster outputs into outputs
                Object.assign(
                    this.serverless.service.provider.compiledCloudFormationTemplate.Outputs,
                    vpc.getOutputs(),
                    cluster.getOutputs()
                );
            } else console.info('serverless-ecs-plugin: skipping cluster creation, missing informations (check required VPC).');
        }
    }

}

export = ServerlessECSPlugin;
