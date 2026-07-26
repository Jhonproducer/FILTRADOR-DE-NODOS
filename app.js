const { createApp, ref, computed, watch, onMounted } = Vue;

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        // --- BASE DE DATOS ---
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // --- ESTADOS DE MODALES ---
        // Modal para enviar desde Pool/Blacklist a una Cuenta
        const assignModal = ref({ isOpen: false, nodeId: '', sourceIndexToRemove: null });
        // Modal para pedir un ID desde la pestaña Cuentas
        const selectorModal = ref({ isOpen: false, targetIndex: null });

        // --- PERSISTENCIA ---
        const saveData = () => {
            localStorage.setItem('vpn_erp_accounts', JSON.stringify(accounts.value));
            localStorage.setItem('vpn_erp_pool', JSON.stringify(pool.value));
            localStorage.setItem('vpn_erp_blacklist', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            const savedAccounts = JSON.parse(localStorage.getItem('vpn_erp_accounts'));
            if (savedAccounts && savedAccounts.length > 0) {
                accounts.value = savedAccounts;
            } else {
                // Pre-cargar 28 cuentas para ahorrar trabajo
                const initialAccounts = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initialAccounts.push({ name: `LON-${num}`, nodeId: '', ip: '' });
                }
                accounts.value = initialAccounts;
            }
            pool.value = JSON.parse(localStorage.getItem('vpn_erp_pool')) || [];
            blacklist.value = JSON.parse(localStorage.getItem('vpn_erp_blacklist')) || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

        // --- MOTOR DE COLISIONES ---
        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc === currentAccount) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();

                const ipChoque = accIp !== '' && curIp !== '' && accIp === curIp;
                const nodoChoque = accNode !== '' && curNode !== '' && accNode === curNode;
                return ipChoque || nodoChoque;
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        // --- CUENTAS ACTIVAS ---
        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '' });
            setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 50);
        };

        const removeAccount = (index) => {
            if(confirm("¿Eliminar esta fila?")) accounts.value.splice(index, 1);
        };

        const burnNode = (index) => {
            const acc = accounts.value[index];
            const nodeStr = (acc.nodeId || '').trim();
            const ipStr = (acc.ip || '').trim();
            if(!nodeStr && !ipStr) return;
            
            if(confirm(`¿Quemar nodo "${nodeStr}" y enviarlo a Lista Negra?`)) {
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 15);
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: ipStr || 'Desconocida' });
                    }
                }
                accounts.value[index].nodeId = '';
                accounts.value[index].ip = '';
            }
        };

        // --- FLUJOS DE "CERO COPY-PASTE" ---
        
        // 1. Abrir Modal: Del Pool/Blacklist -> Enviar a Cuenta
        const openAssignModal = (nodeId, blacklistIndex = null) => {
            assignModal.value.nodeId = nodeId;
            assignModal.value.sourceIndexToRemove = blacklistIndex; // Si viene de la blacklist, guardamos su index
            assignModal.value.isOpen = true;
        };

        // Confirmar envío a la cuenta seleccionada
        const confirmAssign = (accountIndex) => {
            accounts.value[accountIndex].nodeId = assignModal.value.nodeId;
            // Si el nodo venía de la lista negra, lo sacamos de allí (Libertad)
            if (assignModal.value.sourceIndexToRemove !== null) {
                blacklist.value.splice(assignModal.value.sourceIndexToRemove, 1);
            }
            assignModal.value.isOpen = false;
            // Te lleva a la pestaña de cuentas automáticamente para que solo pegues la IP
            currentTab.value = 'accounts'; 
        };

        // 2. Abrir Modal: De Cuenta -> Buscar en el Pool
        const openSelectorModal = (source, index) => {
            selectorModal.value.targetIndex = index;
            selectorModal.value.isOpen = true;
        };

        // Confirmar selección desde el pool
        const confirmSelection = (nodeId) => {
            accounts.value[selectorModal.value.targetIndex].nodeId = nodeId;
            selectorModal.value.isOpen = false;
        };


        // --- LISTA NEGRA: LIBERTAD A FUTURO ---
        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 15);
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: '' });
                    }
                }
            });
            bulkBlacklistText.value = ''; 
            alert(`Bloqueo masivo completado.`);
        };

        const restoreToPool = (index) => {
            if(confirm("¿Perdonar este nodo? Desaparecerá de bloqueados y volverá a estar disponible en el Pool la próxima vez que sincronices.")) {
                blacklist.value.splice(index, 1);
            }
        };

        // --- IMPORTACIÓN POOL JSON ---
        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const rawPool = [];
                    data.forEach(nodo => {
                        if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                        const idCorto = nodo.provider_id.substring(0, 15);
                        
                        const enBlacklist = blacklist.value.some(b => b.nodeId === idCorto);
                        const enUso = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                        
                        if (!enBlacklist && !enUso) {
                            rawPool.push({
                                id: idCorto,
                                country: nodo.location?.country || 'N/A',
                                city: nodo.location?.city || 'N/A',
                                asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                                q_score: (nodo.quality?.quality || 0).toFixed(2)
                            });
                        }
                    });
                    pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
                    syncStatus.value = `¡${pool.value.length} nodos cargados!`;
                    event.target.value = null; 
                    setTimeout(() => { syncStatus.value = ''; }, 3000);
                } catch (err) {
                    alert("Error leyendo JSON");
                    event.target.value = null;
                }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text) => {
            await navigator.clipboard.writeText(text);
            syncStatus.value = '¡Copiado!';
            setTimeout(() => { syncStatus.value = ''; }, 2000);
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        onMounted(() => {
            loadData();
            setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 100);
        });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, collisionCount,
            assignModal, selectorModal,
            hasCollision, addAccount, removeAccount, burnNode, 
            openAssignModal, confirmAssign, openSelectorModal, confirmSelection,
            processBulkBlacklist, restoreToPool, importPoolJSON, 
            copyToClipboard, exportDatabase
        };
    }
}).mount('#app');
