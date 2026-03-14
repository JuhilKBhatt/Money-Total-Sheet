# ./manage_db.py
import argparse
import subprocess
import sys
import os
import time

# --- Defaults ---
DEFAULT_ENV = "dev"

def load_config(env):
    """
    Determines which docker-compose file and DB settings to use.
    Reads .env file to find the actual Database User/Name.
    """
    config = {
        "compose_file": "docker-compose.dev.yml",
        "service_name": "backend",
        "db_service": "db",
        "db_user": "devuser",       # Fallback based on your compose file
        "db_name": "devdatabase"    # Fallback based on your compose file
    }

    # 1. Select Compose File
    if env == "dev":
        config["compose_file"] = "docker-compose.dev.yml"
        print(f"🔧 Mode: DEVELOPMENT (Using {config['compose_file']})")
    elif env == "prod":
        config["compose_file"] = "docker-compose.prod.yml"
        config["db_name"] = "proddatabase"
        config["db_user"] = "produser"
        print(f"🚀 Mode: PRODUCTION (Using {config['compose_file']})")

    # 2. Override defaults by reading .env file (if it exists)
    if os.path.exists(".env"):
        print("📄 Reading settings from .env file...")
        with open(".env") as f:
            for line in f:
                if line.strip() and not line.startswith("#"):
                    parts = line.strip().split("=", 1)
                    if len(parts) == 2:
                        key, value = parts
                        if key == "POSTGRES_DB":
                            config["db_name"] = value
                        if key == "POSTGRES_USER":
                            config["db_user"] = value
    else:
        print("⚠️  Warning: backend/.env file not found. Using defaults.")

    return config

def run_command(command, shell=False, check=True):
    """Runs a shell command and prints output."""
    try:
        cmd_str = ' '.join(command) if isinstance(command, list) else command
        print(f"▶️  Executing: {cmd_str}")
        subprocess.run(command, shell=shell, check=check)
    except subprocess.CalledProcessError as e:
        print(f"❌ Error: Command failed with exit code {e.returncode}")
        sys.exit(e.returncode)

def check_docker_running(config):
    """Ensures the specific environment's containers are up."""
    try:
        result = subprocess.run(
            ["docker-compose", "-f", config["compose_file"], "ps", "-q", config["service_name"]],
            capture_output=True, text=True
        )
        if not result.stdout.strip():
            print("⚠️  Docker containers are not running.")
            print("🔄 Starting them now...")
            run_command(["docker-compose", "-f", config["compose_file"], "up", "-d"])
            print("⏳ Waiting 5 seconds for services to initialize...")
            time.sleep(5)
    except Exception as e:
        print(f"❌ Docker seems to be missing or broken: {e}")
        sys.exit(1)

def update_models(config, message):
    """Generates an Alembic migration file and applies it."""
    check_docker_running(config)
    
    print(f"1️⃣  Generating migration script: '{message}'...")
    run_command([
        "docker-compose", "-f", config["compose_file"], "exec", config["service_name"],
        "alembic", "revision", "--autogenerate", "-m", message
    ])
    
    print("2️⃣  Applying changes to Database...")
    run_command([
        "docker-compose", "-f", config["compose_file"], "exec", config["service_name"],
        "alembic", "upgrade", "head"
    ])
    print("✅ Database schema updated successfully!")

def view_data(config):
    """Opens a PostgreSQL shell inside the DB container."""
    check_docker_running(config)
    print(f"👀 Connecting to database '{config['db_name']}' as '{config['db_user']}'...")
    print("💡 Hint: Type '\\dt' to list tables, '\\q' to exit.")
    
    subprocess.run([
        "docker-compose", "-f", config["compose_file"], "exec", config["db_service"],
        "psql", "-U", config["db_user"], "-d", config["db_name"]
    ])

def delete_data(config, env):
    """Wipes the database volume and restarts the stack."""
    if env == "prod":
        confirm = input("🚨 DANGER: You are about to DELETE ALL PRODUCTION DATA. Type 'DESTROY' to confirm: ")
        if confirm != "DESTROY":
            print("❌ Operation cancelled.")
            return
    else:
        confirm = input("⚠️  WARNING: This will reset the DEV database. Are you sure? (y/n): ")
        if confirm.lower() != 'y':
            print("❌ Operation cancelled.")
            return

    print("💥 Stopping containers and removing volumes...")
    run_command(["docker-compose", "-f", config["compose_file"], "down", "-v"])
    
    print("🔄 Starting Database first...")
    run_command(["docker-compose", "-f", config["compose_file"], "up", "-d", config["db_service"]])
    
    print("⏳ Waiting 10 seconds for PostgreSQL to initialize...")
    time.sleep(10) 
    
    print("🚀 Starting backend and frontend...")
    run_command(["docker-compose", "-f", config["compose_file"], "up", "-d"])
    
    print("⏳ Waiting 5 seconds for backend to boot up...")
    time.sleep(5)
    
    print("🌱 Re-initializing Database Schema with Alembic...")
    run_command([
        "docker-compose", "-f", config["compose_file"], "exec", config["service_name"],
        "alembic", "upgrade", "head"
    ])
    print("✅ Data wiped and schema reset.")

def restore_backup(config, file_path):
    """Restores database from a .sql file."""
    if not os.path.exists(file_path):
        print(f"❌ File not found: {file_path}")
        sys.exit(1)

    check_docker_running(config)
    print(f"📥 Restoring '{config['db_name']}' from {file_path}...")
    
    full_cmd = (
        f"cat {file_path} | "
        f"docker-compose -f {config['compose_file']} exec -T {config['db_service']} "
        f"psql -U {config['db_user']} -d {config['db_name']}"
    )
    
    run_command(full_cmd, shell=True)
    print("✅ Database restored successfully.")

def main():
    parser = argparse.ArgumentParser(description="Manage Money-Total-Sheet Database")
    
    parser.add_argument(
        "--env", 
        choices=["dev", "prod"], 
        default="dev", 
        help="Target environment (default: dev)"
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # Command: update
    parser_update = subparsers.add_parser("update", help="Generate migration and upgrade DB")
    parser_update.add_argument("-m", "--message", default="update models", help="Migration message")

    # Command: view
    subparsers.add_parser("view", help="Open interactive SQL shell")

    # Command: delete
    subparsers.add_parser("delete", help="Wipe database and restart (Reset)")

    # Command: restore
    parser_restore = subparsers.add_parser("restore", help="Restore DB from a .sql file")
    parser_restore.add_argument("file", help="Path to the .sql backup file")

    args = parser.parse_args()
    config = load_config(args.env)

    if args.command == "update":
        update_models(config, args.message)
    elif args.command == "view":
        view_data(config)
    elif args.command == "delete":
        delete_data(config, args.env)
    elif args.command == "restore":
        restore_backup(config, args.file)

if __name__ == "__main__":
    main()