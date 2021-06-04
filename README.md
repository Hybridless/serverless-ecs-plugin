# serverless-ecs-plugin ![Node.js Package](https://github.com/hybridless/serverless-ecs-plugin/workflows/Node.js%20Package/badge.svg)

> **⚠ WARNING: Plugin under initial development .**  
> Exceptions, breaking changes and malfunctioning is expected til 0.1.0 is reach. \
> Documentation is also not up to date.

### Overall

- ![npm](https://img.shields.io/npm/dy/@hybridless/serverless-ecs-plugin) ![npm](https://img.shields.io/npm/v/@hybridless/serverless-ecs-plugin) ![npm (tag)](https://img.shields.io/npm/v/@hybridless/serverless-ecs-plugin/latest) ![Libraries.io dependency status for latest release, scoped npm package](https://img.shields.io/librariesio/release/npm/@hybridless/serverless-ecs-plugin)
- ![GitHub commit activity](http://img.shields.io/github/commit-activity/m/hybridless/serverless-ecs-plugin)
- ![GitHub last commit](http://img.shields.io/github/last-commit/hybridless/serverless-ecs-plugin)

#### About
This plugin will create a cluster, load balancer, vpc, subnets, and one or more services to associate with it. This plugin implements the following approaches:

- Public VPC / Public ALB / Public Subnet 
- Private VPC / Private ALB / Private Subnet

If you would like to reference the VPC elsewhere (such as other clusters). The VPC will be called `VPC{stage}` where `{stage}` is the stage in the serverless.yml. The subnets will be called `SubnetName{stage}{index}` where `{stage}`is the stage in the serverless.yml, and `{index}` references the index of the subnet that was specified in the subnets array. *THESE ARE NOT ADDED TO OUTPUT*. So you can only reference them in the same serverless.yml / same cf stack.

#### Notes
- This plugin only supports AWS provider
- Docker image must be built / uploaded / and properly tagged (this can be done by @hybridless/hybridless plugin)

#### Options
```javascript
  [serverless.yml content]
  ....
  ecs: Array<{
    //Misc
    tags: {
      owner: Me
      Customer: You
    };
    enableContainerInsights?: boolean; //default is respecting account settings
    //Load balancer
    albPrivate?: boolean; //default to false, and only considered when auto creating ALB (no listener specified)
    albDisabled?: boolean; //tasks can have exposed ports (to private VPC) but no alb attached to it
    albListenerArn?: string; //custom ALB by specifying its listener
    timeout?: number; //ALB timeout, defaults to 30
    //ECS cluster
    clusterArns?: { //Indicates if the cluster will not be created and an shared ECS cluster should be used instead
        ecsClusterArn: string; //ECS cluster ARN
        ecsIngressSecGroupId: string; //Ingress ECS VPC Group 
    };
    clusterName: string; //required, cluster name
    //IAM
    executionRoleArn?: string; // execution role for services, generated if not specified
    //VPC
    vpc: {
        //if this options are specified it will create a VPC
        cidr: string;
        subnets: string[]; // subnet cidrs
        //If this options are specified it will attach to existing VPC.
        //all of then are required, if one missing it will turn to self-created 
        //VPC as described above -- All vpc parameters below are intrinsic safe 
        //ivars meaning that all of then accept intrinsic functions 💪
        vpcId: string;
        securityGroupIds: string[] | any;  //object allows intrinsict functions
        subnetIds: string[] | any;  //object allows intrinsict functions
        albSubnetIds?: string[] | object; //object allows intrinsict functions -- will superseed subnetsIds for the ALB if specified
    };
    //Services/tasks (1:1)
    services: Array<{
        name: string; // name of the service
        environment: { [key: string]: string }; // environment variables passed to docker container
        propagateTags?: ('OFF' | 'SERVICE' | 'TASK' ); //defaults to off

        //Service auto scaling
        autoScale?: {
              min?: number; //default to 1
              max?: number; //default to 1
              metric: AutoScalingMetricType;
              cooldown?: number; //defaults to 30
              cooldownIn?: number; //defaults to cooldown but has priority over it
              cooldownOut?: number; //defaults to cooldown but has priority over it
              targetValue: number;
        }
        //Load balancer
        hostname?: string | string[]; //optional hostname for filter on ALB 
        limitSourceIPs?: string | string[]; //optional limit source IPs on ALB (only request made by the specified source IPs are allowed)
        limitHeaders?: { name: string, value: string | string[] }[]; //optional limit headers on ALB (only requests made with the specified headers are allowed)
        path?: string | { path: string, method?: string, priority: number }[]; // path which the ALB should send traffic to, defaults '*' (everything) and users priority 1 on the ALB
        listeners?: Array<{
            //If specifing a listener, you should have or the protocol or the port set,
            //otherwise a random port will be attached to it
              //If not albProtocol is set, this port will not be attached to the ALB
            albProtocol?: "HTTP" | "HTTPS";
            port?: number;
            //
            certificateArns?: string[]; // needed for https
            authorizer?: {
              poolArn: string;
              clientId: string;
              poolDomain: string;
            }; //available on HTTPS only
        }>;
        //ALB Health check
        healthCheckUri?: string; // defaults to "/"
        healthCheckProtocol?: string; // defaults to "HTTP"
        healthCheckInterval?: number // in seconds, defaults to 6 seconds
        healthCheckTimeout?: number; // in seconds, defaults to 5 seconds
        healthCheckHealthyCount?: number; // defaults to 2
        healthCheckUnhealthyCount?: number; // defaults to 2
        //concurrency and task configurations
        desiredCount?: number; // defaults to 1
        ec2LaunchType?: boolean; //defaults to false, if true will laucnh task into EC2
        cpu: number;
        memory: number;
        //docker images
        image?: string; //optional image full URL
          //optionally, can be specified individually
        imageRepository?: string; //image URL repo
        imageTag?: string; //image tag
        entryPoint?: string[]; //custom container entry point
        //scheduler
        schedulerRate?: string; //creates event rule to invoke task the concurrency below or if not specified it will use 1
        schedulerConcurrency?: number;
        schedulerInput?: any;
        //IAM
        taskRoleArn?: string | object; //which role should the task have
        //Logs
        logsMultilinePattern?: string; //regex pattern to match multiline logs (useful for js objects for example)
    }>
}>
```





#### Examples
```TODO```

####Outputs
  For the configuration above CF will have the reference `ECSTestClusterExampleNameServiceHTTP` to be used on your serverless template as `${cf:stackName.ECSTestClusterExampleNameServiceHTTP}`

  For more information about your stack name, please, check [here][1] 
  
  [1]: https://serverless.com/framework/docs/providers/aws/guide/variables#reference-cloudformation-outputs

