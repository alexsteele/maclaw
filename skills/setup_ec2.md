# Setup EC2

Instructions to set up a maclaw sandbox on EC2 with session manager.

- Verify local AWS access first with `aws sts get-caller-identity`.
- Verify the local region with `aws configure get region`.
- Ensure the Session Manager plugin is installed and working.
- Create an EC2 IAM role with `AmazonSSMManagedInstanceCore`.
- Create an instance profile and attach that role to it.
- Launch a small Amazon Linux 2023 instance with that instance profile.
- Wait for the instance to appear in AWS Systems Manager.
- Connect with `aws ssm start-session --target <instance-id>`.
- Install base packages and Node.js on the instance.
- Clone the maclaw repo on the instance.
- Run `npm install` and `npm run build`.
- Start the remote runtime directly with
  `node dist/index.js server --api-only --port 4000`.
- Start session manager with port forwarding on the local machine. See command below.
- Run maclaw /teleport to teleport into the remote.

## Command Reference

Main local verification commands:

```shell
aws sts get-caller-identity
aws configure get region
session-manager-plugin --version
```

Main IAM setup commands:

```shell
aws iam create-role ...
aws iam attach-role-policy ...
aws iam create-instance-profile ...
aws iam add-role-to-instance-profile ...
```

Main EC2 + Session Manager commands:

```shell
aws ec2 run-instances ...
# Copy the InstanceId from the run-instances output.
aws ec2 wait instance-running ...
aws ssm describe-instance-information ...
aws ssm start-session --target <instance-id>
```

If the instance id is not handy, find it with:

```shell
aws ec2 describe-instances \
  --region <region> \
  --filters Name=tag:Name,Values=maclaw-sandbox-dev \
  --query 'Reservations[].Instances[].InstanceId' \
  --output text
```

Main remote bootstrap commands:

```shell
sudo dnf update -y
sudo dnf install -y git tar gzip
# install node 24
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs
git clone <repo-url>
npm install
npm run build
node dist/index.js server --api-only --port 4000 --log-stderr
```

Main Session Manager port-forward + teleport test:

```shell
aws ssm start-session \
  --region us-west-2 \
  --target <instance-id> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["4000"],"localPortNumber":["4100"]}'

maclaw teleport http://127.0.0.1:4100 "/help"
```
