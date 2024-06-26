//Plugin
export type IPlugin = IClusterOptions[];

//Cluster (ECS Cluster)
export interface IClusterOptions {
    tags?: object;
    enableContainerInsights?: boolean; //default is respecting account settings
    disabled?: boolean; //Will not deploy this and services if true
    //Load balancer
    albPrivate?: boolean; //default to false, and only considered when auto creating ALB
    albDisabled?: boolean;
    albListenerArn?: string;
    timeout?: number; //ALB timeout, defaults to 30
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
    vpc?: IVPCOptions;
}

//Service/Task (1:1 here)
export type IServiceOptions = {
    name: string;
    environment?: { [key: string]: (string | object )};
    propagateTags?: PropagateTagsType; //defaults to off
    privileged?: boolean
    volumes?: { name: string, source: string }[]
    mountPoints?: {source: string, dest: string}[]
    //ASG
    autoScale?: IServiceAutoScalingOptions;
    //Load balancer
    hostname?: string | string[]; //optional hostname for filter on ALB 
    limitSourceIPs?: string | string[]; //optional limit source IPs on ALB
    limitHeaders?: { name: string, value: string | string[] }[]; //optional limit headers on ALB
    listeners?: IServiceListener[];
    path?: string | { path: string, method?: string, priority: number }[]; // path the LB should send traffic to, defaults '*' (everything) nad users priority 1 on the ALB
    healthCheckUri?: string; // defaults to "/"
    healthCheckProtocol?: string; // defaults to "HTTP"
    healthCheckInterval?: number // in seconds, defaults to 6 seconds
    healthCheckTimeout?: number; // in seconds, defaults to 5 seconds
    healthCheckHealthyCount?: number; // defaults to 2
    healthCheckUnhealthyCount?: number; // defaults to 2
    healthCheckStatusCode?: number; // optional custom status code for health check
    deregistrationDelay?: number; //optional target group deregistration delay, aws defaults to 300sec
    //Logs
    logsMultilinePattern?: string; //regex pattern to match multiline logs (useful for js objects for example)
    logsRetentionInDays?: number; //defaults to 365 days
    //IAM
    taskRoleArn?: string | object;
    //concurrency and task configurations
    desiredCount?: number; // defaults to 1
    ec2LaunchType?: boolean; //defaults to false, if true will laucnh task into EC2
    cpu: number;
    memory: number;
    softCPU?: number;
    hardCPU?: number;
    softMemory?: number;
    //docker images
    image?: string;
    entryPoint?: string[]; //custom container entry point
    imageRepository?: string;
    imageTag?: string;
    //scheduler
    schedulerRate?: string; //creates event rule to invoke task the concurrency below or if not specified it will use 1
    schedulerConcurrency?: number;
    schedulerInput?: any;
} & ( IServiceEC2Options | IServiceFargateOptions );
//
export interface IServiceEC2Options {
    ec2LaunchType: true;
    daemonEc2Type?: boolean; //default to false, and only considered when ec2LaunchType is true
    placementConstraints?: { expression: string, type: 'distinctInstance' | 'memberOf' }[];
    placementStrategies?: { field: string, type: 'binpack' | 'random' | 'spread' }[];
    capacityProviderStrategy?: { base: number, capacityProvider: string, weight: number }[];
};
export interface IServiceFargateOptions {
    ec2LaunchType?: false | undefined;
    disablePublicIPAssign?: boolean; //only used on fargate (not in ec2)
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
    securityGroupIds: string[] | any;  //object allows intrinsict functions
    subnetIds: string[] | any;  //object allows intrinsict functions
    albSubnetIds?: string[] | object; //object allows intrinsict functions
};

//Service Protocol (alb listener)
export type IServiceListener = {
    certificateArns?: string[]; // needed for https
    authorizer?: {
        poolArn: string;
        clientId: string;
        poolDomain: string;
    }; //available on HTTPS only
} & (
    {
        albProtocol: "HTTP" | "HTTPS"; //dictitates if service will be attached to ALB or not
        port?: number; 
        containerPort?: number;
    }
     |
    {
        albProtocol?: "HTTP" | "HTTPS"; //dictitates if service will be attached to ALB or not
        port: number;
        containerPort?: number;
    }
)

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
    scaleIn?: IServiceBasicStepScalingPolicy;
    scaleOut?: IServiceBasicStepScalingPolicy;
}
export interface IServiceBasicStepScalingPolicy {
    //scaling
    adjustmentType?: 'ChangeInCapacity' | 'ExactCapacity' | 'PercentChangeInCapacity'; //defaults to ChangeInCapacity
    cooldown?: number; //default to 300
    aggregation: 'Average' | 'Maximum' | 'Minimum';
    minAdjustmentMagnitude?: number; //Should only be used with PercentChangeInCapacity
    scaleBy?: number; //defaults to 1 or -1
    //scaling metric
    metricNamespace: string;
    metricName: string;
    metricDimension: string;
    metricDimensionTarget: string;
    metricPeriod?: number; //defaults to 120
    metricEvaluationPeriod?: number; //defaults to 1
    operator: 'GreaterThanOrEqualToThreshold' | 'GreaterThanThreshold' | 'LessThanThreshold' | 'LessThanOrEqualToThreshold' | 'LessThanLowerOrGreaterThanUpperThreshold' | 'LessThanLowerThreshold' | 'GreaterThanUpperThreshold';
    targetValue: number;
    //additional config (scaling metric)
    metricDependsOn?: string | string[];
    additionalDimension?: { dimension: string, target: string }[];
    treatMissingData?: ' breaching' | 'notBreaching' | 'ignore' | 'missing'; //defaults to notBreaching
    fillupMissingData?: any; //fillup value is used on absence of data. default to false, true uses '0', number can be specified instead if any other fillup values is needed.
};

//Misc
export enum PropagateTagsType {
    OFF = 'OFF', 
    SERVICE = 'SERVICE', 
    TASK = 'TASK'
};
