/**
 * Get the GitHub workflow template for a Bun project with environment variables
 */
export function getEnvBunWorkflow(setupProdBranch: boolean): string {
  let workflow = `name: Deploy Bun Express App

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
            unset COMPOSE_PROJECT_NAME
`; // End of original workflow string

  if (setupProdBranch) {
    workflow += `

  create-pr:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout main
        uses: actions/checkout@v3
        with:
          ref: main
      
      - name: Set up Git
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
      
      - name: Check if prod branch exists
        id: check-branch
        run: |
          if git ls-remote --heads origin prod | grep prod; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi
      
      - name: Create prod branch if it doesn't exist
        if: steps.check-branch.outputs.exists == 'false'
        run: |
          git checkout -b prod
          git push origin prod
      
      - name: Modify docker-compose for production
        id: modify-domain
        run: |
          # Update the domain in docker-compose.yml to production
          if [ -f "docker-compose.yml" ]; then
            # Replace test domain with production domain
            sed -i 's/Host(\\\`[^\\\`]*\\\`)/Host(\\\`prod.domain.com\\\`)/g' docker-compose.yml
            
            # Update the port from 3000:3000 to 3001:3000 for production
            sed -i 's/3000:3000/3001:3000/g' docker-compose.yml
            
            # Check if the file was actually modified
            if git diff --quiet docker-compose.yml; then
              echo "No changes found in docker-compose.yml"
              echo "changes_made=false" >> $GITHUB_OUTPUT
            else
              echo "Domain and port updated to production in docker-compose.yml"
              echo "changes_made=true" >> $GITHUB_OUTPUT
            fi
          else
            echo "docker-compose.yml not found!"
            echo "changes_made=false" >> $GITHUB_OUTPUT
            exit 1
          fi
      
      - name: Create PR for domain changes
        if: steps.modify-domain.outputs.changes_made == 'true'
        uses: peter-evans/create-pull-request@v4
        with:
          token: \${{ secrets.PAT }}
          commit-message: Update domain and port for production
          title: Deploy to Production
          body: |
            This PR updates the configuration for production deployment:
            
            - Changed domain to production 
            - Updated port mapping from 3000:3000 to 3001:3000
            
            This PR was automatically created after a successful test deployment.
          branch: update-to-prod
          branch-suffix: timestamp
          delete-branch: true
          base: prod
          
      - name: Fetch prod branch for comparison
        run: |
          git fetch origin prod || true
          
      - name: Check for code changes beyond domain
        id: check-changes
        run: |
          if git ls-remote --heads origin prod | grep -q prod; then
            # Compare main and prod branches excluding docker-compose.yml
            OTHER_CHANGES=$(git diff --name-only origin/main origin/prod | grep -v "docker-compose.yml" || true)
            
            if [ -n "$OTHER_CHANGES" ]; then
              echo "Other files have changes beyond docker-compose.yml"
              echo "has_other_changes=true" >> $GITHUB_OUTPUT
              echo "CHANGED_FILES<<EOF" >> $GITHUB_ENV
              echo "$OTHER_CHANGES" >> $GITHUB_ENV
              echo "EOF" >> $GITHUB_ENV
            else
              echo "No other changes between branches beyond docker-compose.yml"
              echo "has_other_changes=false" >> $GITHUB_OUTPUT
            fi
          else
            echo "Prod branch doesn't exist yet for comparison"
            echo "has_other_changes=false" >> $GITHUB_OUTPUT
          fi
      
      - name: Create PR with all code changes
        if: steps.check-changes.outputs.has_other_changes == 'true'
        uses: peter-evans/create-pull-request@v4
        with:
          token: \${{ secrets.PAT }}
          commit-message: Sync all changes from main to prod
          title: Sync all changes from main to production
          body: |
            This PR includes all changes from main branch ready for production deployment.
            
            Changed files include:
            \${{ env.CHANGED_FILES }}
          branch: sync-all-changes
          branch-suffix: timestamp
          delete-branch: true
          base: prod
`;
  }
  
  return workflow;
}