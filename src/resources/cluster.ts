import { IClusterOptions, IServiceOptions} from "../options";
import {VPC} from "./vpc";
import {Service} from "./service";
import {LoadBalancer} from './loadBalancer';
import {NamePostFix, Resource} from "../resource";

export class Cluster extends Resource<IClusterOptions> {

    private readonly vpc: VPC;
    public readonly services: Service[];
    public readonly loadBalancer: LoadBalancer;
    private readonly serviceName: string;

    public constructor(stage: string, options: IClusterOptions, vpc: VPC, serviceName: string, tags?: object) {
        super(options, stage, `${serviceName}${options.clusterName}`, tags);
        this.vpc = vpc;
        this.serviceName = serviceName;
        this.services = this.options.services.map((serviceOptions: IServiceOptions): any => {
            return new Service(this.stage, serviceOptions, this, tags);
        });
        this.loadBalancer = new LoadBalancer(stage, options, this, tags);
    }

    /* Resource life-cycle */
    public getOutputs(): any {
        let outputs = { ...this.loadBalancer.getOutputs() };
        this.services.forEach((service: Service) => {
            outputs = { ...outputs, ...service.getOutputs() }
        });
        return outputs;
    }
    public generate(): any {
        // generate the defs for each service
        const defs: any[] = this.services.map((service: Service): any => service.generate());
        return Object.assign({
            ...(this.isSharedCluster() ? {} : {
                [this.getName(NamePostFix.CLUSTER)]: {
                    "Type": "AWS::ECS::Cluster",
                    "DeletionPolicy": "Delete",
                    "Properties": {
                        "ClusterName": this.getName(NamePostFix.CLUSTER),
                        ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                        ...(this.options.enableContainerInsights ? { "ClusterSettings": [{ Name: 'containerInsights', value: 'enabled' }] } : {})
                    }
                },
                ...this.getClusterSecurityGroups(),
            }),
            ...this.loadBalancer.generate(),
        }, ...defs);
    }

    /* Public Getters */
    public getExecutionRoleArn(): string | undefined { return this.options.executionRoleArn; }
    public getVPC(): VPC { return this.vpc; }
    public isSharedCluster(): boolean {
        return !!(this.options.clusterArns && this.options.clusterArns.ecsClusterArn && this.options.clusterArns.ecsClusterArn != 'null' &&
            this.options.clusterArns.ecsIngressSecGroupId && this.options.clusterArns.ecsIngressSecGroupId != 'null');
    }
    public getClusterRef(): any {
        return (this.isSharedCluster() ? this.options.clusterArns.ecsClusterArn : { "Ref": this.getName(NamePostFix.CLUSTER) })
    }
    public getClusterIngressSecGroup(): any {
        return (this.isSharedCluster() ? this.options.clusterArns.ecsIngressSecGroupId : { "Ref": this.getName(NamePostFix.CONTAINER_SECURITY_GROUP) });
    }

    /* Private */
    private getClusterSecurityGroups(): any {
        if (this.getVPC().useExistingVPC()) { return {}; } //No security group resource is required
        else {
            return {
                [this.getName(NamePostFix.CONTAINER_SECURITY_GROUP)]: {
                    "Type": "AWS::EC2::SecurityGroup",
                    "DeletionPolicy": "Delete",
                    "Properties": {
                        ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                        "GroupDescription": "Access to the ECS containers",
                        "VpcId": this.getVPC().getRefName()
                    }
                },
                [this.getName(NamePostFix.SECURITY_GROUP_INGRESS_SELF)]: {
                    "Type": "AWS::EC2::SecurityGroupIngress",
                    "DeletionPolicy": "Delete",
                    "Properties": {
                        "Description": "Ingress from other containers in the same security group",
                        "GroupId": {
                            "Ref": this.getName(NamePostFix.CONTAINER_SECURITY_GROUP)
                        },
                        "IpProtocol": -1,
                        "SourceSecurityGroupId": {
                            "Ref": this.getName(NamePostFix.CONTAINER_SECURITY_GROUP)
                        }
                    }
                }
            };
        }
    }
}
