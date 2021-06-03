import { IClusterOptions, IServiceOptions} from "../options";
import {VPC} from "./vpc";
import {Service} from "./service";
import {NamePostFix, Resource} from "../resource";
import {Cluster} from './cluster';
import { Protocol } from "./protocol";

export class LoadBalancer extends Resource<IClusterOptions> {

    private readonly cluster: Cluster;

    public constructor(stage: string, options: IClusterOptions, cluster: Cluster, tags?: object) {
        super(options, stage, cluster.getNamePrefix(), tags);
        this.cluster = cluster;
    }

    /* Resource life-cycle */
    public getOutputs(): any { return {}; }
    public generate(): any {
        return Object.assign({
            ...(this.options.albDisabled ? {} : {
                ...(this.options.albListenerArn ? {} : {
                    [this.getName(NamePostFix.LOAD_BALANCER)]: {
                        "Type": "AWS::ElasticLoadBalancingV2::LoadBalancer",
                        "DeletionPolicy": "Delete",
                        "Properties": {
                            "Name": this.getName(NamePostFix.LOAD_BALANCER),
                            ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                            "Scheme": (this.options.albPrivate ? "internal" : "internet-facing"),
                            "LoadBalancerAttributes": [
                                {
                                    "Key": "idle_timeout.timeout_seconds",
                                    "Value": (this.options.timeout || 30)
                                }
                            ],
                            "Subnets": this.cluster.getVPC().getALBSubnets(),
                            "SecurityGroups": this.getALBSecurityGroupsRef()
                        },
                    },
                    ...this.getListeners()
                }),
                ...this.getServicesSecurityGroups(),
            }),
        });
    }


    /* Security groups */
    private getALBSecurityGroupsRef(): any {;
        let secGroups = [];
        this.cluster.services.forEach((service: Service) => {
            //service has alb enabled and is public
            if (!this.cluster.getOptions().albDisabled && service.listeners.find((l) => l.isALBListenerEnabled())) {
                secGroups.push({ "Ref": this.getSecurityGroupNameByService(service) });
            }
        });
        //Check if need to append specified SGs
        if (this.cluster.getVPC().useExistingVPC()) {
            if (Array.isArray(this.cluster.getVPC().getSecurityGroups())) secGroups = secGroups.concat(this.cluster.getVPC().getSecurityGroups());
            else if (this.cluster.getVPC().getSecurityGroups()['Fn::Split']) { //handle case where split is specified but we need to make the split operation before concating
                const split = this.cluster.getVPC().getSecurityGroups()['Fn::Split'];
                const parts = split[1].split(split[0]);
                secGroups = secGroups.concat(parts);
            } else secGroups.push(this.cluster.getVPC().getSecurityGroups());
        }  return secGroups;
    }

    private getSecurityGroupNameByService(service: Service): string {
        return `${this.getName(NamePostFix.LOAD_BALANCER_SECURITY_GROUP)}${service.getOptions().name}`;
    }
    
    private getServicesSecurityGroups(): object {
        let secGroups = {};
        this.cluster.services.forEach( (service: Service) => {
            secGroups = {
                ...secGroups,
                ...this.generateSecurityGroupsByService(service)
            };
        });
        return secGroups;
    }

    private generateSecurityGroupsByService(service: Service): any {
        //check if alb is enabled for this service
        if (this.cluster.getOptions().albDisabled || !service.listeners.find((l) => l.isALBListenerEnabled())) return {};
        const ALBServiceSecGroup = this.getSecurityGroupNameByService(service);
        return {
            //Public security groups
            ...(!this.cluster.getOptions().albPrivate ? {
                [ALBServiceSecGroup]: {
                    "Type": "AWS::EC2::SecurityGroup",
                    "DeletionPolicy": "Delete",
                    "Properties": {
                        ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                        "GroupDescription": `Access to the public facing load balancer - task ${service.getName(NamePostFix.SERVICE)}`,
                        "VpcId": this.cluster.getVPC().getRefName(),
                        "SecurityGroupIngress": [
                            {
                                "CidrIp": "0.0.0.0/0",
                                //Todo: Can we improve security here?
                                // ...(service.port ? {
                                //     "IpProtocol": 'tcp',
                                //     "toPort": service.port,
                                //     "fromPort": service.port
                                // } : { })
                                "IpProtocol": -1
                            }
                        ]
                    }
                },
                ...(!this.cluster.getVPC().useExistingVPC() &&
                    {
                        [ALBServiceSecGroup + NamePostFix.SECURITY_GROUP_INGRESS_ALB]: {
                            "Type": "AWS::EC2::SecurityGroupIngress",
                            "DeletionPolicy": "Delete",
                            "Properties": {
                                "Description": `Ingress from the ALB - task ${service.getName(NamePostFix.SERVICE)}`,
                                "GroupId": this.cluster.getClusterIngressSecGroup(),
                                "IpProtocol": -1,
                                "SourceSecurityGroupId": {
                                    "Ref": ALBServiceSecGroup
                                }
                            }
                        }
                    }
                )
            } : {
                /*TODO: if not public AND also not specifiying a VPC, different secgroup must be created
                        - in/outbound from all subnets on the vpc? */
            })
        }
    }

    /* Elastic Load Balance -- this should be moved to ALB class when implemented */
    private getListeners(): any {
        const aggServices = this.getAggregatedServices();
        let listeners = {};
        Object.keys(aggServices).forEach( (listenerKey) => {
            const listener = aggServices[listenerKey];
            if (listener.listener.isALBListenerEnabled()) {
                const defaultService = listener.services[0];
                listeners = {
                    ...listeners,
                    [this.getName(NamePostFix.LOAD_BALANCER_LISTENER) + listener.listener.port]: {
                        "Type": "AWS::ElasticLoadBalancingV2::Listener",
                        "DeletionPolicy": "Delete",
                        "DependsOn": [
                            this.getName(NamePostFix.LOAD_BALANCER)
                        ],
                        "Properties": {
                            "DefaultActions": [{ //Note: this is just the default, no biggie
                                "TargetGroupArn": {
                                    "Ref": defaultService.getName(NamePostFix.TARGET_GROUP) + listener.listener.port
                                },
                                "Type": "forward"
                            }],
                            "LoadBalancerArn": {
                                "Ref": this.getName(NamePostFix.LOAD_BALANCER)
                            },
                            "Port": listener.listener.port,
                            "Protocol": listener.listener.getOptions().albProtocol,
                            ...(listener.listener.getOptions().albProtocol == "HTTPS" ? {
                                "Certificates": listener.listener.getOptions().certificateArns.map((certificateArn: string): any => ({
                                    "CertificateArn": certificateArn
                                }))
                            } : {}
                            )
                        }
                    }
                };
            }
        });
        return listeners;
    }
    private getAggregatedServices(): any {
        //Sanity check -- check if have more than one service listening for the same port, but different protocol
        //This is not allowed, better to explicty deny it rather than creating confusion os misconfigured systems
        let mappings = {};
        for (let service of this.cluster.services) {
            for (let listener of service.listeners) {
                if (!listener.getOptions().albProtocol) continue;
                if (mappings[listener.port]) {
                    if (mappings[listener.port].proto.getOptions().albProtocol != listener.getOptions().albProtocol) {
                        throw new Error(`Serverless: ecs-plugin: Service ${service.getOptions().name} on cluster ${this.cluster.getName(NamePostFix.CLUSTER)}, listener ${listener.getOptions().albProtocol} is colliding with different service at same cluster on port ${listener.port}. Can't continue!`);
                    }
                    mappings[listener.port].services.push(service);
                } else mappings[listener.port] = { listener, services: [service]};
            }
        }
        return mappings;
    }
}
