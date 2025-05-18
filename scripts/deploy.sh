git clone <this-repo-url>
cd model-eval-pipeline
npm install        # installs CDK + AWS SDK v3 + esbuild

# one-liner deploy
cdk deploy EvalStack \
  -c targetRegion=us-east-1 \
  -c rightStackBusArn=<OPTIONAL pre-existing EventBridge Bus ARN>