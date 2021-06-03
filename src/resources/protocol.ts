import {NamePostFix, Resource} from "../resource";
import {IServiceListener} from "../options";
import {Service} from "./service";
import {Cluster} from "./cluster";

export class Protocol extends Resource<IServiceListener> {

    private readonly cluster: Cluster;
    private readonly service: Service;
    public readonly port: number;

    public constructor(cluster: Cluster,
                       service: Service,
                       stage: string,
                       options: IServiceListener, 
                       port: number,
                       tags?: object) {
        super(options, stage, service.getNamePrefix(), tags);
        this.cluster = cluster;
        this.service = service;
        this.port = port;
    }

    /* Resource life-cycle */
    public getOutputs(): any {
        //do not generate output if no load balancer is created by us
        if (this.cluster.getOptions().albListenerArn || !this.isALBListenerEnabled()) return {};
        return {
            [this.service.getName(NamePostFix.SERVICE) + this.options.albProtocol]: {
                "Description": "Elastic load balancer service endpoint",
                "Export": {
                    "Name": this.service.getName(NamePostFix.SERVICE) + this.options.albProtocol.toUpperCase() + (this.options.port || '')
                },
                "Value": {
                    "Fn::Join": [
                        "",
                        [
                            this.options.albProtocol.toLowerCase(),
                            "://",
                            { "Fn::GetAtt": [this.cluster.loadBalancer.getName(NamePostFix.LOAD_BALANCER), "DNSName"] },
                            ":",
                            this.port 
                        ]
                    ]
                }
            }
        };
    }
    public generate(): any {
        if (this.options.albProtocol === "HTTPS" && (!this.options.certificateArns || this.options.certificateArns.length === 0)) {
            throw new Error('Certificate ARN required for HTTPS');
        }
        return this.generateListenerRules();
    }

    /* Public getters */
    public getName(namePostFix: NamePostFix): string {
        return super.getName(namePostFix) + (this.options.albProtocol ? this.options.albProtocol.toUpperCase() : '') + (this.options.port || '');
    }

    public isALBListenerEnabled(): boolean {
        return !!(!this.cluster.getOptions().albDisabled && this.getOptions().albProtocol);
    }
    public getListenerRulesName(): string[] {
        if (typeof this.service.getOptions().path === 'string') {
            return [`${this.getName(NamePostFix.LOAD_BALANCER_LISTENER_RULE)}${0}`];
        } else if (Array.isArray(this.service.getOptions().path)) {
            const rules: any = this.service.getOptions().path;
            return rules.map((p, index) => {
                return `${this.getName(NamePostFix.LOAD_BALANCER_LISTENER_RULE)}${index}`;
            });
        } else {
            return [`${this.getName(NamePostFix.LOAD_BALANCER_LISTENER_RULE)}${0}`];
        }
    }

    /* Resources */
    private generateListenerRules(): any {
        if (typeof this.service.getOptions().path === 'string') {
            const path: any = this.service.getOptions().path;
            return this.generateListenerRule(path, 0);
        } else if (Array.isArray(this.service.getOptions().path)) {
            const rules: any = this.service.getOptions().path;
            let _retRules = {};
            rules.forEach((p, index) => {
                _retRules = {
                    ..._retRules,
                    ...this.generateListenerRule((p.path || p), index, p.method, p.priority)
                };
            });
            return _retRules;
        } else {
            return this.generateListenerRule('*', 0);
        }
    }
    private generateListenerRule(path: string, index: number, method?: string, priority?: number): any {
        const usingAuthorizer: boolean = !!(this.options.albProtocol == 'HTTPS' && this.options.authorizer);
        return {
            [`${this.getName(NamePostFix.LOAD_BALANCER_LISTENER_RULE)}${index}`]: {
                "Type": "AWS::ElasticLoadBalancingV2::ListenerRule",
                "DeletionPolicy": "Delete",
                "Properties": {
                    "Actions": [
                        ...(usingAuthorizer ? [{
                            "AuthenticateCognitoConfig": {
                                "UserPoolArn": this.options.authorizer.poolArn,
                                "UserPoolClientId": this.options.authorizer.clientId,
                                "UserPoolDomain": this.options.authorizer.poolDomain
                            },
                            "Type": "authenticate-cognito",
                            "Order": 1
                        }] : []),
                        {
                            "TargetGroupArn": {
                                "Ref": this.service.getName(NamePostFix.TARGET_GROUP) + this.options.port
                            },
                            "Type": "forward",
                            ...(usingAuthorizer ? {"Order": 2} : {})
                        }
                    ],
                    "Conditions": [
                        {
                            "Field": "path-pattern",
                            "Values": [path]
                        },
                        ...(method && method != '*' && method != 'ANY' ? [{
                            "Field": "http-request-method",
                            "HttpRequestMethodConfig": { "Values": [method] }
                        }] : []),
                        ...(usingAuthorizer ? [{
                            "Field": "http-header",
                            "HttpHeaderConfig": {
                                "HttpHeaderName": "authorization",
                                "Values": [ "*" ]
                            }
                        }] : []),
                        ...(this.service.getOptions().hostname ? [{
                            "Field": "host-header",
                            "HostHeaderConfig": {
                                "Values": (Array.isArray(this.service.getOptions().hostname) ? this.service.getOptions().hostname : [this.service.getOptions().hostname])
                            }
                        }] : []),
                        ...(this.service.getOptions().limitSourceIPs ? [{
                            "Field": "source-ip",
                            "SourceIpConfig": {
                                "Values": (Array.isArray(this.service.getOptions().limitSourceIPs) ? this.service.getOptions().limitSourceIPs : [this.service.getOptions().limitSourceIPs])
                            }
                        }] : []),
                        ...(this.service.getOptions().limitHeaders ? this.service.getOptions().limitHeaders.map((obj) => {
                            return {
                                "Field": "http-header",
                                "HttpHeaderConfig": {
                                    "HttpHeaderName": obj.name,
                                    "Values": (Array.isArray(obj.value) ? obj.value : [obj.value])
                                }    
                            }
                        }) : []),
                    ],
                    "ListenerArn": (this.cluster.getOptions().albListenerArn || {
                        "Ref": this.cluster.loadBalancer.getName(NamePostFix.LOAD_BALANCER_LISTENER) + this.port
                    }),
                    "Priority": (priority || 1)
                }
            }
        }
    }

}
