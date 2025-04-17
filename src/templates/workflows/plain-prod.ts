export function getPlainBunProdWorkflow(): string {
    return `name: Deploy Bun Express App

on:
  push:
    branches: [ main ]
  workflow_dispatch:  # Allow manual triggering

# Add permissions to the GITHUB_TOKEN
permissions:
  contents: write
  pull-requests: write  

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0  # Fetch all history for proper exclusion
      
      - name: Get repository name
        id: repo-name
        run: echo "REPO_NAME=\${GITHUB_REPOSITORY#*/}" >> $GITHUB_ENV
      
      - name: Prepare files for deployment
        run: |
          # Create a clean directory for deployment
          mkdir -p deploy
          # Copy files to the clean directory, excluding unwanted files
          rsync -av --exclude='.git/' --exclude='node_modules/' --exclude='.env' --exclude='dist/' --exclude='bun.lockb' . deploy/
      
      - name: Create project directory on server
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.SERVER_HOST }}
          username: \${{ secrets.SERVER_USER }}
          key: \${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            mkdir -p /home/\${{ secrets.SERVER_USER }}/\${{ env.REPO_NAME }}-test
      
      - name: Copy project files to server
        uses: appleboy/scp-action@master
        with:
          host: \${{ secrets.SERVER_HOST }}
          username: \${{ secrets.SERVER_USER }}
          key: \${{ secrets.SSH_PRIVATE_KEY }}
          source: "deploy/*"
          target: "/home/\${{ secrets.SERVER_USER }}/\${{ env.REPO_NAME }}-test"
          rm: true  # Remove old files in the target directory
          strip_components: 1  # Remove the 'deploy' directory prefix
      
      - name: Copy production environment file
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.SERVER_HOST }}
          username: \${{ secrets.SERVER_USER }}
          key: \${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /home/\${{ secrets.SERVER_USER }}/\${{ env.REPO_NAME }}-test
            # Create production environment file if it doesn't exist
            if [ ! -f .env ]; then
              echo "PORT=3000" > .env
              echo "NODE_ENV=production" >> .env
            fi
      
      - name: Build and deploy on test server
        uses: appleboy/ssh-action@master
        env:
          COMPOSE_PROJECT_NAME: "\${{ env.REPO_NAME }}-test"
        with:
          host: \${{ secrets.SERVER_HOST }}
          username: \${{ secrets.SERVER_USER }}
          key: \${{ secrets.SSH_PRIVATE_KEY }}
          envs: COMPOSE_PROJECT_NAME
          script: |
            cd /home/\${{ secrets.SERVER_USER }}/\${{ env.REPO_NAME }}-test
            
            # Export environment variables
            export COMPOSE_PROJECT_NAME="\${COMPOSE_PROJECT_NAME}"
            
            # Force removal of any existing containers for this project
            docker compose down
            
            # Clean up any old containers that might be causing conflicts
            docker container prune -f
            
            # Build and start containers
            docker compose build --no-cache
            docker compose up -d
            
            # Clean up old images
            docker image prune -f
            
            # Verify the container is running
            docker compose ps
            
            # Check logs for any startup issues
            docker compose logs --tail=20 app
            
            # Clear environment variables
            unset COMPOSE_PROJECT_NAME`
}  