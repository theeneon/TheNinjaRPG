FROM nanomathias/vscode-devcontainer:release-1.2.3

# Install apt install -y pkg-config
# RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
# RUN apt-get update && apt-get install -y \
#   default-libmysqlclient-dev \
#   pkg-config \
#   gcc \
#   pkg-config \
#   && rm -rf /var/lib/apt/lists/*

# Install gitmoji
RUN npm i -g gitmoji-cli

# Install drizzle-kit
RUN npm i -g drizzle-kit
RUN npm install -g pnpm

# Show we're in devcontainer
RUN bash -c "$(curl -fskSL https://raw.github.com/ohmybash/oh-my-bash/master/tools/install.sh)"
RUN sed -i 's/OSH_THEME="font"/OSH_THEME="agnoster"/g' /home/vscode/.bashrc

# Extras
RUN pip install thefuck
RUN echo "eval \"\$(thefuck --alias)\"" >> /home/vscode/.bashrc

# Change to non-root
USER vscode

# Setting the ENTRYPOINT to docker-init.sh will configure non-root access to
# the Docker socket if "overrideCommand": false is set in devcontainer.json.
# The script will also execute CMD if you need to alter startup behaviors.
ENTRYPOINT [ "/usr/local/share/docker-init.sh" ]
CMD [ "sleep", "infinity" ]