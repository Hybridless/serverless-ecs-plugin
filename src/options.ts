//Plugin
export type IPlugin = IClusterOptions[];

//Cluster (ECS Cluster)
export interface IClusterOptions {
    tags?: object;
    enableContainerInsights?: boolean; //default is respecting account settings
    //Load balancer
    public: boolean;
    disableELB?: boolean;
    elbListenerArn?: string;
    timeout?: number; //ELB timeout, defaults to 30
    //Cluster
    clusterName: string;
    clusterArns?: {
        ecsClusterArn: string;
        ecsIngressSecGroupId: string;
    };
    services: IServiceOptions[];
    //IAM
    executionRoleArn?: string; // role for services, generated if not specfied
    //VPC
    vpc: IVPCOptions;
}

//Service/Task (1:1 here)
export interface IServiceOptions {
    name: string;
    environment?: { [key: string]: (string | object )};
    propagateTags?: PropagateTagsType; //defaults to off
    //ASG
    autoScale?: IServiceAutoScalingOptions;
    //Load balancer
    disableELB?: boolean; //useful for disabling ELB listeners on a cluster that has ELB and more tasks with ELB enabled
    port?: number; // docker port (the port exposed on the docker image) - if not specified random port will be used - usefull for busy private subnets 
    hostname?: string | string[]; //optional hostname for filter on ELB 
    limitSourceIPs?: string | string[]; //optional limit source IPs on ELB
    limitHeaders?: { Name: string, Value: string | string[] }[]; //optional limit headers on ELB
    protocols: IServiceProtocolOptions[];
    priority?: number; // priority for routing, defaults to 1
    path?: string | { path: string, method?: string }[]; // path the LB should send traffic to, defaults '*' (everything)
    healthCheckUri?: string; // defaults to "/"
    healthCheckProtocol?: string; // defaults to "HTTP"
    healthCheckInterval?: number // in seconds, defaults to 6 seconds
    healthCheckTimeout?: number; // in seconds, defaults to 5 seconds
    healthCheckHealthyCount?: number; // defaults to 2
    healthCheckUnhealthyCount?: number; // defaults to 2
    //Logs
    logsMultilinePattern?: string; //regex pattern to match multiline logs (useful for js objects for example)
    //IAM
    taskRoleArn?: string | object;
    //concurrency and task configurations
    desiredCount?: number; // defaults to 1
    ec2LaunchType?: boolean; //defaults to false, if true will laucnh task into EC2
    daemonEc2Type?: boolean; //default to false, and only considered when ec2LaunchType is true
    cpu: number;
    memory: number;
    placementConstraints?: { expression: string, type: 'distinctInstance' | 'memberOf' }[];
    placementStrategies?: { field: 'string', type: 'binpack' | 'random' | 'spread' }[];
    capacityProviderStrategy?: { base: number, capacityProvider: string, weight: number }[];
    //docker images
    image?: string;
    entryPoint?: string[]; //custom container entry point
    imageRepository?: string;
    imageTag?: string;
    //scheduler
    schedulerRate?: string; //creates event rule to invoke task the concurrency below or if not specified it will use 1
    schedulerConcurrency?: number;
    schedulerInput?: any;
}

//VPC
export type IVPCOptions = IVPCOptions_Dedicated | IVPCOptions_Shared;
export interface IVPCOptions_Dedicated {
    cidr: string;
    subnets: string[];
};
export interface IVPCOptions_Shared {
    //Optional ivars to dictate if will use existing VPC and subnets specified
    vpcId: string;
    securityGroupIds: string[];
    subnetIds: string[];
};

//Service Protocol (alb listener)
export interface IServiceProtocolOptions {
    protocol: "HTTP" | "HTTPS";
    certificateArns?: string[]; // needed for https
    authorizer?: {
        poolArn: string;
        clientId: string;
        poolDomain: string;
    }; //available on HTTPS only
}

//ASG
export enum AutoScalingMetricType {
    ALBRequestCountPerTarget,
    AppStreamAverageCapacityUtilization,
    ComprehendInferenceUtilization,
    DynamoDBReadCapacityUtilization,
    DynamoDBWriteCapacityUtilization,
    EC2SpotFleetRequestAverageCPUUtilization,
    EC2SpotFleetRequestAverageNetworkIn,
    EC2SpotFleetRequestAverageNetworkOut,
    ECSServiceAverageCPUUtilization,
    ECSServiceAverageMemoryUtilization,
    LambdaProvisionedConcurrencyUtilization,
    RDSReaderAverageCPUUtilization,
    RDSReaderAverageDatabaseConnections,
    SageMakerVariantInvocationsPerInstance
};
export interface IServiceAutoScalingOptions {
    min?: number; //default to 1
    max?: number; //default to 1
    metric: AutoScalingMetricType;
    cooldown?: number; //defaults to 30
    cooldownIn?: number; //defaults to cooldown but has priority over it
    cooldownOut?: number; //defaults to cooldown but has priority over it
    targetValue: number;
}

//Misc
export enum PropagateTagsType {
    OFF = 'OFF', 
    SERVICE = 'SERVICE', 
    TASK = 'TASK'
};
