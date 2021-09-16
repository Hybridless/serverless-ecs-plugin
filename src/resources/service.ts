import { IServiceOptions, IServiceListener, PropagateTagsType, IServiceFargateOptions, IServiceEC2Options} from "../options";
import {Cluster} from "./cluster";
import {NamePostFix, Resource} from "../resource";
import {Protocol} from "./protocol";

export class Service extends Resource<IServiceOptions> {
    private readonly logGroupName: string;
    private readonly cluster: Cluster;
    private readonly executionRole: string;
    public readonly listeners: Protocol[];
    //
    public constructor(stage: string, options: IServiceOptions, cluster: Cluster, tags?: object) {
        // camelcase a default name
        const safeResourceName = cluster.getNamePrefix() + options.name
            .toLowerCase() // lowercase everything
            .replace(/[^A-Za-z0-9]/g, ' ') // replace non alphanumeric with soaces
            .split(' ') // split on those spaces
            .filter((piece: string): boolean => piece.trim().length > 0) // make sure we only accept 1 char or more
            .map((piece: string): string => piece.charAt(0).toUpperCase() + piece.substring(1)) // capitalize each piece
            .join('');// join back to a single string
        //
        super(options, stage, safeResourceName, tags); 
        this.cluster = cluster;
        this.executionRole = `${cluster.getNamePrefix()}ECSServiceExecutionRole${this.stage}`;
        //Only generate protocols if needed
        this.listeners = this.options.listeners?.map((listener: IServiceListener, index): any => {
            //use specified port for the first protocol
            const port = (listener.port || (listener.albProtocol ? (listener.albProtocol == 'HTTP' ? 80 : 443) : (Math.floor(Math.random() * 49151) + 1024)));
            console.debug(`Serverless: ecs-plugin: Using port ${port} for service ${options.name} on cluster ${cluster.getName(NamePostFix.CLUSTER)} - ALB is ${listener.albProtocol ? `enabled with protocol: ${listener.albProtocol}` : 'is not enabled!'}`);
            return new Protocol(cluster, this, stage, listener, port, tags);
        }) || [];
        //we do not use UID on log group name because we want to persist logs from one deployment to another
        this.logGroupName = `/aws/ecs/${this.cluster.getNamePrefix()}/${this.stage}/${options.name}`;
    }

    /* Resource life-cycle */
    public generate(): any {
        const executionRole: any | undefined = this.cluster.getExecutionRoleArn() ? undefined : this.generateExecutionRole();
        return Object.assign(
            {},
            this.generateService(),
            this.generateTaskDefinition(),
            this.generateLogGroup(),
            this.generateSchedulerEventRule(),
            ...this.listeners.map((listener: Protocol): any => {
                if (listener.isALBListenerEnabled()) {
                    return { ...listener.generate(), ...this.generateTargetGroup(listener) };
                } else return {};
            }),
            this.generateAutoscaling(),
            executionRole // could be undefined, so set it last
        );
    }

    public getOutputs(): any {
        let outputs = {};
        this.listeners.forEach((listener: Protocol) => {
            outputs = { ...outputs, ...listener.getOutputs() }
        }); 
        return outputs;
    }


    /* Private helpers */
    private getExecutionRoleValue(): string | object {
        const executionRoleArn: string | undefined = this.cluster.getExecutionRoleArn();
        if (executionRoleArn) return executionRoleArn;
        return { "Ref": this.executionRole };
    }

    private getSecurityGroups(): any {
        if (this.cluster.getVPC().useExistingVPC()) {
            return this.cluster.getVPC().getSecurityGroups();  
        } return [ this.cluster.getClusterIngressSecGroup() ];
    }

    private getListenerRuleNames(): string[] {
        const listenerRules = [];
        this.listeners.forEach((listener: Protocol): void => {
            listener.getListenerRulesName().forEach(element => listenerRules.push(element));
        });
        return listenerRules;
    }

    /* Resources */
    private generateService(): object {
        return {
            [this.getName(NamePostFix.SERVICE)]: {
                "Type": "AWS::ECS::Service",
                "DeletionPolicy": "Delete",
                ...(this.listeners.find((l) => l.isALBListenerEnabled()) ? {
                    "DependsOn": this.getListenerRuleNames(),
                } : {}),
                "Properties": {
                    "ServiceName": this.getName(NamePostFix.SERVICE),
                    "Cluster": this.cluster.getClusterRef(),
                    ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                    ...(this.hasTags() ? { "EnableECSManagedTags": true } : {}),
                    "LaunchType": (this.options.ec2LaunchType ? "EC2" : "FARGATE"),
                    ...(this.options.ec2LaunchType && this.options.daemonEc2Type ? { "SchedulingStrategy": "DAEMON" } : {}),
                    "DeploymentConfiguration": {
                        "MaximumPercent": 200,
                        "MinimumHealthyPercent": 75
                    },
                    "DesiredCount": (this.options.desiredCount ? this.options.desiredCount : 1),
                    ...(!this.options.ec2LaunchType ? {"NetworkConfiguration": {
                        "AwsvpcConfiguration": {
                            "AssignPublicIp": ((this.options as IServiceFargateOptions).disablePublicIPAssign ? "DISABLED" : "ENABLED"),
                            "SecurityGroups": this.getSecurityGroups(),
                            "Subnets": this.cluster.getVPC().getSubnets()
                        }
                    }} : {}),
                    "TaskDefinition": {
                        "Ref": this.getName(NamePostFix.TASK_DEFINITION)
                    },
                    ...(this.listeners.find((l) => l.isALBListenerEnabled()) ? {
                        "LoadBalancers": this.listeners.filter((l) => l.isALBListenerEnabled()).map((l) => ({
                                "ContainerName": this.getName(NamePostFix.CONTAINER_NAME),
                                "ContainerPort": l.port,
                                "TargetGroupArn": { "Ref": this.getName(NamePostFix.TARGET_GROUP) + l.port }
                            }))
                    } : {}),
                    ...(this.options.propagateTags && this.options.propagateTags != PropagateTagsType.OFF ? { "PropagateTags": this.options.propagateTags } : {}),
                    ...((this.options as IServiceEC2Options).placementConstraints ? { "PlacementConstraints": (this.options as IServiceEC2Options).placementConstraints.map((a) => ({ Expression: a.expression, Type: a.type })) } : {}),
                    ...((this.options as IServiceEC2Options).placementStrategies ? { "PlacementStrategies": (this.options as IServiceEC2Options).placementStrategies.map((a) => ({ Field: a.field, Type: a.type })) } : {}),
                    ...((this.options as IServiceEC2Options).capacityProviderStrategy ? { "CapacityProviderStrategy": (this.options as IServiceEC2Options).capacityProviderStrategy.map((a) => ({ Base: a.base, Weight: a.weight, CapacityProvider: a.capacityProvider })) } : {}),
                    
                }
            },
        };
    }

    private generateTaskDefinition(): object {
        return {
            [this.getName(NamePostFix.TASK_DEFINITION)]: {
                "Type": "AWS::ECS::TaskDefinition",
                "DeletionPolicy": "Delete",
                "Properties": {
                    ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                    "Family": `${this.getName(NamePostFix.TASK_DEFINITION)}`,
                    "Cpu": this.options.cpu,
                    "Memory": this.options.memory,
                    "NetworkMode": (this.options.ec2LaunchType ? 'bridge' : "awsvpc"),
                    "RequiresCompatibilities": [
                        (this.options.ec2LaunchType ? "EC2" : "FARGATE"),
                    ],
                    "ExecutionRoleArn": this.getExecutionRoleValue(),
                    "TaskRoleArn": this.options.taskRoleArn ? this.options.taskRoleArn : ({
                        "Ref": "AWS::NoValue"
                    }),
                    "ContainerDefinitions": [
                        Object.assign({
                            "Name": this.getName(NamePostFix.CONTAINER_NAME),
                            "Cpu": this.options.cpu,
                            "Memory": this.options.memory,
                            "Image": this.options.image || `${this.options.imageRepository}:${this.options.name}-${this.options.imageTag}`,
                            ...(this.options.entryPoint ? { "EntryPoint": this.options.entryPoint } : {}),
                            ...(this.listeners.length > 0 ? {
                                "PortMappings": this.listeners.map((l) => ({ "ContainerPort": l.port }))
                            } : {}),
                            "LogConfiguration": {
                                "LogDriver": "awslogs",
                                "Options": {
                                    "awslogs-group": this.logGroupName,
                                    "awslogs-region": {
                                        "Ref": "AWS::Region"
                                    },
                                    "awslogs-stream-prefix": this.getName(NamePostFix.TASK_DEFINITION),
                                    ...(this.options.logsMultilinePattern ? { 'awslogs-multiline-pattern': this.options.logsMultilinePattern } : {})
                                }
                            }
                        },
                        this.options.environment && {
                            "Environment": Object.keys(this.options.environment).map(name => ({
                                "Name": name,
                                "Value": this.options.environment[name],
                            }))
                        })
                    ]
                }
            }
        };
    }

    private generateTargetGroup(listener: Protocol): any {
        return {
            [this.getName(NamePostFix.TARGET_GROUP) + listener.getOptions().port]: {
                "Type": "AWS::ElasticLoadBalancingV2::TargetGroup",
                "DeletionPolicy": "Delete",
                "Properties": {
                    ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                    "HealthCheckIntervalSeconds": this.options.healthCheckInterval ? this.options.healthCheckInterval : 6,
                    "HealthCheckPath": this.options.healthCheckUri ? this.options.healthCheckUri : "/",
                    "HealthCheckProtocol": this.options.healthCheckProtocol || 'HTTP',
                    "HealthCheckTimeoutSeconds": this.options.healthCheckTimeout ? this.options.healthCheckTimeout : 5,
                    "HealthyThresholdCount": this.options.healthCheckHealthyCount ? this.options.healthCheckHealthyCount : 2,
                    "TargetType": (this.options.ec2LaunchType ? "instance" : "ip"),
                    // "Name": this.getName(NamePostFix.TARGET_GROUP), -- should not be set - allow replacement
                    "Port": listener.getOptions().port,
                    "Protocol": "HTTP", //inside vpc we are theorically good, but HTTPS should be implement on the future for sure. TODO
                    "UnhealthyThresholdCount": this.options.healthCheckUnhealthyCount ? this.options.healthCheckUnhealthyCount : 2,
                    "VpcId": this.cluster.getVPC().getRefName()
                }
            }
        };
    }

    private generateSchedulerEventRule(): any {
        if (!this.options.schedulerRate) return {};
        return {
            [this.getName(NamePostFix.SCHEDULER_EVENT_RULE)]: {
                "Type": "AWS::Events::Rule",
                "Properties": {
                    "Description": `Scheduler for task ${this.getName(NamePostFix.TASK_DEFINITION)}`,
                    "Name": this.getName(NamePostFix.SCHEDULER_EVENT_RULE),
                    "ScheduleExpression": this.options.schedulerRate,
                    "State": "ENABLED",
                    "Targets": [
                        {
                            "Id": this.getName(NamePostFix.SCHEDULER_EVENT_RULE),
                            "RoleArn": this.getExecutionRoleValue(),
                            "EcsParameters": {
                                "TaskDefinitionArn": { "Ref": this.getName(NamePostFix.TASK_DEFINITION) },
                                "TaskCount": (this.options.schedulerConcurrency || 1)
                            },
                            "Arn": {
                                "Fn::GetAtt": [ this.cluster.getName(NamePostFix.CLUSTER), "Arn" ]
                            },
                            ...(this.options.schedulerInput ? {
                                "Input": (typeof this.options.schedulerInput == 'string' ? typeof this.options.schedulerInput : JSON.stringify(this.options.schedulerInput))
                            } : {})
                        }
                    ]
                }
            }
        };
    }

    private generateLogGroup(): any {
        return {
            [this.getName(NamePostFix.LOG_GROUP)]: {
                "Type": "AWS::Logs::LogGroup",
                "DeletionPolicy": "Delete",
                "Properties": {
                    "LogGroupName": this.logGroupName,
                    "RetentionInDays": 30
                }
            }
        };
    }

    /**
     * Technically we generate this per service, but because of how everything is merged at the end
     * only one of these is in the final template
     *
     * @todo move to a better place
     */
    private generateExecutionRole(): any {
        return {
            [this.executionRole]: {
                "Type": "AWS::IAM::Role",
                "DeletionPolicy": "Delete",
                "Properties": {
                    "RoleName": this.executionRole,
                    ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                    "AssumeRolePolicyDocument": {
                        "Statement": [
                            {
                                "Effect": "Allow",
                                "Principal": {
                                    "Service": [
                                        "ecs-tasks.amazonaws.com"
                                    ]
                                },
                                "Action": [
                                    "sts:AssumeRole"
                                ]
                            }
                        ]
                    },
                    "Path": "/",
                    "Policies": [
                        {
                            "PolicyName": "AmazonECSTaskExecutionRolePolicy",
                            "PolicyDocument": {
                                "Statement": [
                                    {
                                        "Effect": "Allow",
                                        "Action": [
                                            "ecr:GetAuthorizationToken",
                                            "ecr:BatchCheckLayerAvailability",
                                            "ecr:GetDownloadUrlForLayer",
                                            "ecr:BatchGetImage",
                                            "logs:CreateLogStream",
                                            "logs:PutLogEvents"
                                        ],
                                        "Resource": "*"
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        };
    }
    /* Auto scaling service -- this also could be moved to another class */
    private generateAutoscaling() {
        if (!this.options.autoScale) return {};
        //Generate auto scaling for this service
        return {
            [this.getName(NamePostFix.AutoScalingRole)]: {
                "Type": "AWS::IAM::Role",
                "DeletionPolicy": "Delete",
                "Properties": {
                    ...(this.getTags() ? { "Tags": this.getTags() } : {}),
                    "RoleName": this.getName(NamePostFix.AutoScalingRole),
                    "AssumeRolePolicyDocument": {
                        "Statement": [
                            {
                                "Effect": "Allow",
                                "Action": "sts:AssumeRole",
                                "Principal": {
                                    "Service": "ecs-tasks.amazonaws.com",
                                }
                            }
                        ]
                    },
                    "ManagedPolicyArns": [
                        "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceAutoscaleRole"
                    ]
                }
            },
            [this.getName(NamePostFix.AutoScalingTarget)]: {
                "Type": "AWS::ApplicationAutoScaling::ScalableTarget",
                "DeletionPolicy": "Delete",
                "Properties": {
                    "MinCapacity": this.options.autoScale.min || 1,
                    "MaxCapacity": this.options.autoScale.max || 1,
                    "ScalableDimension": "ecs:service:DesiredCount",
                    "ServiceNamespace": "ecs",
                    "ResourceId": {
                        "Fn::Join": [
                            "/",
                            [
                                "service", 
                                this.cluster.getClusterRef(),
                                { "Fn::GetAtt": [ this.getName(NamePostFix.SERVICE), "Name" ] }
                            ]
                        ]
                    },
                    "RoleARN": {
                        "Fn::GetAtt": [
                            this.getName(NamePostFix.AutoScalingRole), "Arn"
                        ]
                    }
                }
            },
            [this.getName(NamePostFix.AutoScalingPolicy)]: {
                "Type": "AWS::ApplicationAutoScaling::ScalingPolicy",
                "DeletionPolicy": "Delete",
                "Properties": {
                    "PolicyName": this.getName(NamePostFix.AutoScalingPolicy),
                    "PolicyType": "TargetTrackingScaling",
                    "ScalingTargetId": {
                        "Ref": this.getName(NamePostFix.AutoScalingTarget)
                    },
                    "TargetTrackingScalingPolicyConfiguration": {
                        "ScaleInCooldown": this.options.autoScale.cooldownIn || this.options.autoScale.cooldown || 30,
                        "ScaleOutCooldown": this.options.autoScale.cooldownOut || this.options.autoScale.cooldown || 30,
                        "TargetValue": this.options.autoScale.targetValue,
                        "PredefinedMetricSpecification": {
                            "PredefinedMetricType": this.options.autoScale.metric,
                        }
                    }
                }
            }
        }
    }

}
